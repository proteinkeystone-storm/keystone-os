#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — CALIBRATION DU SEUIL D'ANCRAGE (SA-14.0, 21/07/2026)

   LE PROBLÈME : `GROUND_MIN_VEC = 0.42` (workers/src/routes/smart-agent.js)
   décide, pour CHAQUE question, si l'agent répond ou se replie. Ce nombre
   a été posé à dire d'expert, jamais mesuré — l'audit du 16/07 l'a marqué
   comme une « falaise » : 0.4151 se tait, 0.4200 parle.

   CE QUE FAIT CE SCRIPT : il rejoue les jeux étalons (golden sets) déjà
   saisis dans chaque agent, récupère les signaux BRUTS de la décision
   (topVec / anyLex / semantic), et rejoue la même décision pour tous les
   seuils entre 0.30 et 0.60. Il imprime le seuil qui maximise le score,
   comparé au seuil actuel.

   CE QU'IL NE FAIT PAS : il ne modifie RIEN. Ni la constante, ni la base,
   ni un agent. C'est un rapport de lecture — la décision de bouger
   `GROUND_MIN_VEC` reste humaine, et ne se prend QUE si le gain est net.

   COÛT : le replay golden est GRATUIT côté récupération (aucun LLM), sauf
   pour les questions « doit ignorer » qui s'ancrent quand même (bornées à
   REPLAY_LLM_MAX = 16 appels IA par agent, plafond du worker). Rien n'est écrit.

   MESURE DU 21/07 : sur 44 questions étalons et 3 agents réels, les 31
   seuils de 0.30 à 0.60 donnent le MÊME score. Cause : `anyLex` est presque
   toujours vrai (30 sondes hors sujet sur 30 accrochent une fiche), donc la
   règle `anyLex || !semantic || topVec >= seuil` court-circuite le seuil.
   GROUND_MIN_VEC n'arbitre rien aujourd'hui — le bouger serait sans effet.

   USAGE
     export SA_TEST_JWT="<le ks_jwt de ton navigateur>"
     node scripts/calibrate-ground-threshold.mjs
     node scripts/calibrate-ground-threshold.mjs --agent <id>       # un seul agent
     node scripts/calibrate-ground-threshold.mjs --api http://127.0.0.1:8787
     node scripts/calibrate-ground-threshold.mjs --json             # sortie machine

   OÙ TROUVER LE JWT : dans Keystone, console du navigateur →
     localStorage.ks_jwt
   (jeton de TA session, à ne pas commiter ; il expire, il suffit de se
   reconnecter pour en obtenir un neuf.)
   ═══════════════════════════════════════════════════════════════ */

import { sweepGroundThreshold } from '../workers/src/routes/smart-agent.js';

const argv = process.argv.slice(2);
const optStr = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
};
const API     = optStr('--api', 'https://keystone-os-api.keystone-os.workers.dev');
const ONLY    = optStr('--agent', null);
const AS_JSON = argv.includes('--json');
const JWT     = process.env.SA_TEST_JWT || process.env.KORA_TEST_JWT;

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' };
const say = (s = '') => { if (!AS_JSON) console.log(s); };

if (!JWT) {
  console.error(`\nJeton manquant. Dans Keystone, console du navigateur :\n` +
                `  localStorage.ks_jwt\n\nPuis :\n  export SA_TEST_JWT="<le jeton>"\n`);
  process.exit(2);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/api/smart-agent${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JWT}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch (_) { /* réponse non-JSON : gardée en brut */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error || txt.slice(0, 200)}`);
  return data;
}

/* ── 1. Les agents ─────────────────────────────────────────────── */
say(`${C.dim}${API}${C.off}\n`);
const { agents = [] } = await api('/agents');
const targets = ONLY ? agents.filter(a => a.id === ONLY) : agents;
if (!targets.length) {
  console.error(ONLY ? `Agent « ${ONLY} » introuvable.` : 'Aucun agent sur ce compte.');
  process.exit(2);
}

/* ── 2. Replay golden agent par agent ──────────────────────────── */
const signals = [];
const perAgent = [];
for (const a of targets) {
  let rep;
  try {
    rep = await api(`/agents/${a.id}/golden/replay`, { method: 'POST', body: {} });
  } catch (e) {
    say(`  ${C.red}✗${C.off} ${a.name} — ${e.message}`);
    continue;
  }
  if (!rep.total) { say(`  ${C.dim}·${C.off} ${a.name} ${C.dim}— aucune question étalon${C.off}`); continue; }

  // Un replay d'avant SA-14.0 (worker pas encore déployé) ne renvoie pas les
  // signaux bruts : on le dit franchement plutôt que de calibrer sur du vide.
  const missing = rep.results.filter(r => r.topVec === undefined).length;
  if (missing) {
    say(`  ${C.yel}!${C.off} ${a.name} — worker sans les signaux bruts (SA-14.0 non déployé ?)`);
    continue;
  }
  const s = rep.results.map(r => ({
    expect: r.expect, topVec: r.topVec, anyLex: r.anyLex,
    semantic: r.semantic, hitCount: r.hitCount, llmCites: r.llmCites,
    gapMarked: r.gapMarked,   // SA-14.5 — vrai signal du repli
  }));
  signals.push(...s);
  perAgent.push({ id: a.id, name: a.name, total: rep.total, score: rep.score, signals: s });
  say(`  ${C.grn}✓${C.off} ${a.name} ${C.dim}— ${rep.total} question(s), score actuel ${rep.score}%${C.off}`);
}

if (!signals.length) {
  console.error('\nAucun signal exploitable : aucun agent n\'a de jeu étalon rempli.');
  process.exit(1);
}

/* ── 3. Balayage ───────────────────────────────────────────────── */
const sweep = sweepGroundThreshold(signals);
const gain  = sweep.best.passed - sweep.current.passed;

if (AS_JSON) {
  console.log(JSON.stringify({ api: API, agents: perAgent.map(({ signals: _s, ...a }) => a), sweep }, null, 2));
  process.exit(0);
}

say(`\n${C.bold}── Balayage du seuil d'ancrage ──${C.off}`);
say(`  Questions étalons agrégées : ${sweep.total} (sur ${perAgent.length} agent(s))`);
say(`  Seuil ACTUEL   ${sweep.current.threshold.toFixed(2)} → ${sweep.current.passed}/${sweep.current.total} (${sweep.current.score}%)`);
say(`  Seuil OPTIMAL  ${sweep.best.threshold.toFixed(2)} → ${sweep.best.passed}/${sweep.best.total} (${sweep.best.score}%)`);
say(`  Delta          ${gain > 0 ? C.grn + '+' : C.dim}${gain} question(s)${C.off}`);

// Plateau : sur peu de données, beaucoup de seuils font le même score. Le
// montrer évite de croire à une précision qui n'existe pas.
const plateau = sweep.candidates.filter(c => c.passed === sweep.best.passed).map(c => c.threshold);
say(`  Plateau        ${plateau.length} seuil(s) à égalité, de ${Math.min(...plateau).toFixed(2)} à ${Math.max(...plateau).toFixed(2)}`);

say(`\n${C.bold}── Verdict ──${C.off}`);
if (sweep.total < 30) {
  say(`  ${C.yel}Volume trop mince (${sweep.total} questions) pour trancher.${C.off}`);
  say(`  ${C.dim}Livrable de ce sprint : l'outil + ce rapport. On NE touche PAS`);
  say(`  à GROUND_MIN_VEC — le script reste rejouable quand le golden grossit.${C.off}`);
} else if (gain <= 0) {
  say(`  ${C.grn}Le seuil actuel (0.42) tient.${C.off} Aucun seuil candidat ne fait mieux.`);
  say(`  ${C.dim}Rien à changer — c'est un résultat, pas un échec : la valeur posée`);
  say(`  à dire d'expert est désormais MESURÉE.${C.off}`);
} else if (gain / sweep.total < 0.03) {
  say(`  ${C.yel}Gain marginal (${gain}/${sweep.total} = ${Math.round(gain / sweep.total * 100)}%).${C.off}`);
  say(`  ${C.dim}Sous le bruit : déplacer une constante de prod pour ça n'en vaut pas`);
  say(`  le risque. Rejouer quand le golden aura grossi.${C.off}`);
} else {
  say(`  ${C.grn}Gain net : +${gain} question(s) (${Math.round(gain / sweep.total * 100)}%).${C.off}`);
  say(`  Passer GROUND_MIN_VEC de ${sweep.current.threshold.toFixed(2)} à ${C.bold}${sweep.best.threshold.toFixed(2)}${C.off} est justifié.`);
  say(`  ${C.dim}À faire à la main dans workers/src/routes/smart-agent.js, puis re-déployer.${C.off}`);
}

say(`\n${C.dim}Rappel de biais : les signaux « doit ignorer » n'ont d'appel IA que`);
say(`pour les questions ancrées AU SEUIL COURANT — le balayage est donc`);
say(`pessimiste vers les seuils bas. Un seuil bas qui gagne est un vrai gain.${C.off}`);
