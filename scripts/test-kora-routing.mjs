#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Test routage 2 étages de Kora (19/07/2026)

   Le catalogue plafonne à 31/32 : au-delà de MAX_ACTIONS le worker
   bascule en « aiguillage » (étage 1 : domaines résumés + actions
   globales entières) puis « choix » (étage 2 : les actions du seul
   domaine élu). Testé SANS Workers : _twoStageDecide prend un runLLM
   INJECTABLE — un faux moteur scripté enregistre chaque prompt système
   et rend des sorties prévues. Le catalogue testé est le VRAI
   (KORA_ACTIONS + KORA_PAD_META importés du client).

   Couvre : seuil de bascule, aiguillage domaine → choix, globale dès
   l'étage 1, self-healing (id valide sans param requis accepté ; avec
   param requis → étage 2 forcé), domaine inconnu / sortie illisible →
   repli sobre, réponse directe aux 2 étages, contenu exact des prompts
   (l'étage 1 ne voit AUCUN détail de pad, l'étage 2 ne voit QUE son
   pad), repli sans méta (client ancien), caps de la méta réelle.

   Usage : node scripts/test-kora-routing.mjs   ·   Exit 0 si OK.
   ═══════════════════════════════════════════════════════════════ */

import { execSync }      from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _wantsTwoStage, _twoStageDecide, _parseStage1 } from '../workers/src/routes/kora.js';
import { KORA_ACTIONS, KORA_PAD_META } from '../app/kora-actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else      { failed++; console.error(`  \x1b[31m✗\x1b[0m ${name}`); }
}

/* défs compactes — MÊME mapping que kora-loop._actionDefs (client).
   ⚠ `pad` doit y être : c'est la clé du groupement par domaine — son
   ABSENCE du mapping client est exactement le bug que ce test a attrapé
   à la 1re exécution (domaines tous « undefined », routage mort-né). */
const ACTIONS = KORA_ACTIONS.map(a => ({
  id: a.id, pad: a.pad, label: a.label, desc: a.desc, mode: a.mode || 'read',
  params: (a.params || []).map(p => ({ name: p.name, type: p.type, required: !!p.required, desc: p.desc || '' })),
}));
const MSGS = [{ role: 'user', content: 'mon site est en ligne ?' }];

/* faux moteur : rend les sorties scriptées dans l'ordre, garde les prompts */
function fakeRunner(outputs) {
  const calls = [];
  const runLLM = async (sys, msgs) => { calls.push({ sys, msgs }); return outputs[calls.length - 1] ?? '{"reponse":"?"}'; };
  return { runLLM, calls };
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 1 — seuil de bascule (_wantsTwoStage)\x1b[0m');
{
  /* le seuil se teste sur une taille FIXE (32/33), pas sur ACTIONS.length —
     le vrai catalogue grossit à chaque pad (31 hier, 36 avec Keynapse) et
     un total figé dans ce test casserait à chaque ajout, sans rapport avec
     ce qui est réellement testé ici (le seuil lui-même). */
  const at32 = Array.from({ length: 32 }, (_, i) => ({ id: `x.${i}`, pad: 'x' }));
  const at33 = Array.from({ length: 33 }, (_, i) => ({ id: `x.${i}`, pad: 'x' }));
  check('32 actions (= MAX_ACTIONS) → chemin historique', _wantsTwoStage({ actions: at32 }) === false);
  check('33 actions (> MAX_ACTIONS) → 2 étages automatique', _wantsTwoStage({ actions: at33 }) === true);
  check('routing:"2e" force le chemin même sous le seuil (32)', _wantsTwoStage({ actions: at32, routing: '2e' }) === true);
  check('body vide → false (pas de crash)', _wantsTwoStage({}) === false && _wantsTwoStage(null) === false);
  /* le catalogue RÉEL (36 aujourd'hui) doit lui aussi basculer — sinon la
     désynchro entre ce seuil et MAX_ACTIONS du worker resterait invisible */
  check(`catalogue réel (${ACTIONS.length} actions) déclenche bien les 2 étages`, _wantsTwoStage({ actions: ACTIONS }) === true);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 2 — aiguillage domaine → choix (le chemin nominal)\x1b[0m');
{
  const { runLLM, calls } = fakeRunner([
    '{"domaine":"sentinel"}',
    '{"action":"snt.fleet","args":{},"annonce":"Je regarde ce que Sentinel dit de tes sites."}',
  ]);
  const d = await _twoStageDecide({ runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('2 appels (aiguillage puis choix)', calls.length === 2);
  check('décision finale = snt.fleet', d.action === 'snt.fleet' && !!d.annonce);
  const sys1 = calls[0].sys, sys2 = calls[1].sys;
  check('étage 1 : la ligne de domaine sentinel est là', /- sentinel : /.test(sys1));
  check('étage 1 : tous les domaines non-globaux du catalogue sont listés',
    ['brainstorming', 'ghostwriter', 'social', 'sdqr', 'sentinel', 'keynapse'].every(p => sys1.includes(`- ${p} : `)));
  check('étage 1 : les globales chain.* et os.* sont détaillées', sys1.includes('chain.start') && sys1.includes('chain.cancel') && sys1.includes('os.open_pad'));
  check('étage 1 : AUCUN id de pad (ni snt.* ni qr.* ni sm.* ni kn.*)', !/snt\.|qr\.|sm\.|bs\.|gw\.|kn\./.test(sys1));
  check('étage 2 : les 3 actions sentinel détaillées', sys2.includes('snt.fleet') && sys2.includes('snt.site_report') && sys2.includes('snt.run_audit'));
  check('étage 2 : les desc de params y sont (valeurs admises)', /nom ou adresse/.test(sys2));
  check('étage 2 : rien des autres pads', !/qr\.list|sm\.compose|bs\.start/.test(sys2));
  check('étage 2 : le label humain du domaine est utilisé', sys2.includes('« Sentinel »'));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 3 — étage 1 : globale, réponse, self-healing\x1b[0m');
{
  const g = fakeRunner(['{"action":"chain.start","args":{"brief":"x"},"annonce":"Je lance."}']);
  const dg = await _twoStageDecide({ runLLM: g.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('globale (chain.start) → 1 seul appel, action rendue', g.calls.length === 1 && dg.action === 'chain.start');

  const r = fakeRunner(['{"reponse":"Salut !"}']);
  const dr = await _twoStageDecide({ runLLM: r.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('réponse directe → 1 seul appel, passthrough', r.calls.length === 1 && dr.reponse === 'Salut !');

  /* self-healing : id NON-global émis dès l'étage 1 */
  const s = fakeRunner(['{"action":"snt.fleet","args":{},"annonce":"Je lis."}']);
  const ds = await _twoStageDecide({ runLLM: s.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('id valide SANS param requis → accepté sans étage 2', s.calls.length === 1 && ds.action === 'snt.fleet');

  const p = fakeRunner([
    '{"action":"qr.stats_one","args":{"name":"menu"},"annonce":"Je regarde."}',
    '{"action":"qr.stats_one","args":{"name":"menu","period":"30d"},"annonce":"Je regarde."}',
  ]);
  const dp = await _twoStageDecide({ runLLM: p.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('id AVEC param requis → étage 2 forcé sur SON pad', p.calls.length === 2 && p.calls[1].sys.includes('qr.stats_one') && dp.action === 'qr.stats_one');

  const u = fakeRunner(['{"action":"xx.inconnu","args":{}}']);
  const du = await _twoStageDecide({ runLLM: u.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('id inventé → repli sobre (pas de crash)', u.calls.length === 1 && /emmêlée/.test(du.reponse || ''));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 4 — replis (domaine inconnu, illisible, étage 2 honnête)\x1b[0m');
{
  /* domaine qui n'existe PAS (encore) dans le catalogue — garder ce nom hors
     de toute vraie liste de pads, sinon un futur ajout ferait taire ce test */
  const k = fakeRunner(['{"domaine":"zzz-domaine-inexistant"}']);
  const dk = await _twoStageDecide({ runLLM: k.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('domaine hors catalogue → repli sobre', k.calls.length === 1 && /emmêlée/.test(dk.reponse || ''));

  const b = fakeRunner(['blabla sans le moindre JSON']);
  const db = await _twoStageDecide({ runLLM: b.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('étage 1 illisible → repli sobre', /emmêlée/.test(db.reponse || ''));

  const h = fakeRunner(['{"domaine":"sentinel"}', '{"reponse":"Rien dans Sentinel ne couvre ça."}']);
  const dh = await _twoStageDecide({ runLLM: h.runLLM, actions: ACTIONS, pads: KORA_PAD_META, messages: MSGS });
  check('étage 2 peut répondre honnêtement (reponse passthrough)', dh.reponse === 'Rien dans Sentinel ne couvre ça.');

  /* client ancien : pas de méta → globals par défaut (chaine/os) + lignes
     de domaine dérivées des labels d'actions */
  const o = fakeRunner(['{"domaine":"sentinel"}', '{"action":"snt.fleet","args":{},"annonce":"Je lis."}']);
  const doo = await _twoStageDecide({ runLLM: o.runLLM, actions: ACTIONS, pads: undefined, messages: MSGS });
  check('sans méta (client ancien) → repli labels + globals chaine/os', doo.action === 'snt.fleet'
    && o.calls[0].sys.includes('chain.start') && /- sentinel : /.test(o.calls[0].sys));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 5 — _parseStage1\x1b[0m');
{
  check('domaine plié en minuscules', _parseStage1('{"domaine":"Sentinel"}').domaine === 'sentinel');
  check('plusieurs objets → le DERNIER gagne', _parseStage1('{"domaine":"social"} puis {"reponse":"ok"}').reponse === 'ok');
  check('fence ```json toléré', _parseStage1('```json\n{"domaine":"sdqr"}\n```').domaine === 'sdqr');
  check('vide / sans JSON → null', _parseStage1('') === null && _parseStage1('du texte') === null);
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 6 — méta réelle (KORA_PAD_META vs catalogue)\x1b[0m');
{
  const metaPads = new Set(KORA_PAD_META.map(p => p.pad));
  const catalogPads = new Set(KORA_ACTIONS.map(a => a.pad));
  check('chaque pad du catalogue a son entrée méta', [...catalogPads].every(p => metaPads.has(p)));
  check('chaine et os sont marqués global', KORA_PAD_META.filter(p => p.global).map(p => p.pad).sort().join(',') === 'chaine,os');
  check('desc de domaine ≤ 160 car.', KORA_PAD_META.every(p => !p.desc || p.desc.length <= 160));
  check('les non-globaux ont label + desc (pas de repli en prod)', KORA_PAD_META.filter(p => !p.global).every(p => p.label && p.desc));
}

// ════════════════════════════════════════════════════════════════
console.log('\n\x1b[1m▶ Suite 7 — Syntaxe (node --check)\x1b[0m');
for (const f of ['workers/src/routes/kora.js', 'app/kora-actions.js', 'app/kora-loop.js']) {
  try { execSync(`node --check "${join(ROOT, f)}"`, { stdio: 'pipe' }); check(`${f} — syntaxe OK`, true); }
  catch (e) { check(`${f} — syntaxe OK`, false); console.error(String(e.stdout || e.stderr || e.message)); }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests — \x1b[32m${passed} ok\x1b[0m, ${failed ? `\x1b[31m${failed} ko\x1b[0m` : '0 ko'}`);
process.exit(failed ? 1 : 0);
