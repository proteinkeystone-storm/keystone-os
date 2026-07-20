#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Audit statique du catalogue Kora (K-7, 19/07/2026)

   Vérifie, SANS réseau ni navigateur, les invariants d'intégrité que
   les tests par-pad ne couvrent pas — à relancer à CHAQUE futur pad
   (K-8+) avant tout déploiement :
     · chaque action : id, pad, mode∈{read,write}, desc≤240, target, run ;
     · desc de params ≤ 90 ; desc de domaine (META) ≤ 160 ;
     · chaque pad de KORA_ACTIONS a une entrée KORA_PAD_META ;
     · globaux chaine + os présents ;
     · les DEUX prompts worker (_sysDecide ET _sysStage1) nomment les
       phrases de capacités de chaque pad du dict CAP ci-dessous
       (leçon : toujours les deux) ;
     · aucune capacité COUVERTE citée comme exemple hors-catalogue.

   Ne vérifie PAS l'existence DOM des `target` (grep séparé) ni le
   comportement réel du modèle (= dogfood interactif, cf.
   KORA_FIABILITE_PROTOCOLE.md). Exit 0 si tout passe, 1 sinon.
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync }   from 'node:fs';
import { fileURLToPath }  from 'node:url';
import { dirname, join }  from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

globalThis.localStorage  = { getItem:(k)=>(k==='ks_jwt'?'jwt':null), setItem(){}, removeItem(){} };
globalThis.sessionStorage= { getItem:()=>null, setItem(){}, removeItem(){} };
globalThis.document      = { getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[] };
globalThis.window        = {};

const { KORA_ACTIONS, KORA_PAD_META } = await import('../app/kora-actions.js');

let ko = 0;
const fail = (m)=>{ ko++; console.error('  \x1b[31m✗\x1b[0m '+m); };
const ok   = (m)=>console.log('  \x1b[32m✓\x1b[0m '+m);

const byPad = {}; for (const a of KORA_ACTIONS) (byPad[a.pad]=byPad[a.pad]||[]).push(a);
const reads = KORA_ACTIONS.filter(a=>a.mode==='read').length;
const writes= KORA_ACTIONS.filter(a=>a.mode==='write').length;
console.log(`\n\x1b[1mCatalogue : ${KORA_ACTIONS.length} actions (${reads} lectures, ${writes} écritures), ${Object.keys(byPad).length} pads\x1b[0m`);

console.log('\n\x1b[1m▶ Actions — champs obligatoires\x1b[0m');
for (const a of KORA_ACTIONS) {
  if (!a.id || !a.pad) fail('action sans id/pad');
  if (!['read','write'].includes(a.mode)) fail(a.id+' : mode invalide');
  if (!a.desc) fail(a.id+' : desc manquante'); else if (a.desc.length>240) fail(a.id+' : desc '+a.desc.length+'>240');
  if (!a.target) fail(a.id+' : PAS de target (anneau impossible, B.3)');
  if (typeof a.run!=='function') fail(a.id+' : run non-fonction');
  for (const p of (a.params||[])) if (p.desc && p.desc.length>90) fail(a.id+'/'+p.name+' : param desc '+p.desc.length+'>90');
}
if (!ko) ok(`${KORA_ACTIONS.length} actions : id/pad/mode/desc/target/run + params conformes`);

console.log('\n\x1b[1m▶ KORA_PAD_META ↔ catalogue\x1b[0m');
const metaPads = new Set(KORA_PAD_META.map(m=>m.pad));
let m0=ko;
for (const p of Object.keys(byPad)) if (!metaPads.has(p)) fail('pad "'+p+'" sans entrée KORA_PAD_META');
for (const m of KORA_PAD_META) {
  if (m.global) continue;
  if (!m.label) fail('META '+m.pad+' : label'); 
  if (!m.desc)  fail('META '+m.pad+' : desc'); else if (m.desc.length>160) fail('META '+m.pad+' : desc '+m.desc.length+'>160');
}
for (const g of ['chaine','os']) if (!KORA_PAD_META.some(m=>m.pad===g&&m.global)) fail('global "'+g+'" manquant');
if (ko===m0) ok('chaque pad a sa méta (label+desc≤160), globaux chaine+os présents');

/* mots-indices de capacité par pad (doivent figurer dans la phrase de repli
   « je peux te lire : … » des DEUX prompts) — mis à jour à CHAQUE pad K-8+ */
const CAP = { brainstorming:'séances', ghostwriter:'posts', social:'réseaux', sdqr:'QR', sentinel:'sites', keynapse:'Keynapse', smartagent:'jumeaux', desk:'desK' };
console.log(`\n\x1b[1m▶ Prompts worker — les DEUX chemins nomment les ${Object.keys(CAP).length} pads\x1b[0m`);
const worker = readFileSync(join(ROOT,'workers/src/routes/kora.js'),'utf8');
const sysDecide = worker.slice(worker.indexOf('function _sysDecide'), worker.indexOf('const SYS_ANSWER'));
const sysStage1 = worker.slice(worker.indexOf('function _sysStage1'), worker.indexOf('function _sysStage2'));
let p0=ko;
for (const [pad,mot] of Object.entries(CAP)) {
  if (!sysDecide.includes(mot)) fail(`_sysDecide ne cite pas la capacité "${pad}" (mot « ${mot} »)`);
  if (!sysStage1.includes(mot)) fail(`_sysStage1 ne cite pas la capacité "${pad}" (mot « ${mot} »)`);
}
/* aucune capacité couverte citée comme hors-catalogue (leçon SDQR : « scans
   de QR » l'était). L'exemple hors-catalogue doit rester e-mails/comptabilité. */
for (const s of [['_sysDecide',sysDecide],['_sysStage1',sysStage1]]) {
  if (/hors catalogue|ne couvre pas|hors de mon|je ne sais pas encore lire/i.test(s[1])) {
    if (/scans? de (tes )?QR|tes QR codes.{0,20}hors/i.test(s[1])) fail(`${s[0]} : capacité QR citée comme hors-catalogue`);
  }
}
if (ko===p0) ok(`capacités des ${Object.keys(CAP).length} pads présentes dans _sysDecide ET _sysStage1 ; hors-catalogue sûr`);

console.log('\n\x1b[1m▶ SYS_ANSWER — règles anti-hallucination et mise en page\x1b[0m');
const sysAnswer = worker.slice(worker.indexOf('const SYS_ANSWER'), worker.indexOf('/* ── Aides ── */'));
let a0=ko;
/* chaque règle ci-dessous a été payée par un bug réel en prod — si une
   réécriture du prompt en fait sauter une, on veut le savoir tout de suite */
const RULES = [
  ['N=N sur les listes',            /EXACTEMENT N/],
  ['jamais de libellé générique',   /Post 1/],
  ['statut jamais changé',          /CHANGE JAMAIS un statut/],
  ['quotas = crédits, pas caractères', /CRÉDITS/],
  ['illimité doit être dit',        /illimit/i],
  ['zéro invention',                /zéro invention/i],
  ['mise en page : une ligne par élément (dogfood 19/07)', /RETOUR À LA LIGNE/],
];
for (const [nom, re] of RULES) if (!re.test(sysAnswer)) fail(`SYS_ANSWER : règle « ${nom} » absente`);
if (ko===a0) ok(`${RULES.length} règles SYS_ANSWER présentes`);

console.log(ko ? `\n\x1b[31m${ko} invariant(s) en échec\x1b[0m\n` : `\n\x1b[32mTous les invariants passent.\x1b[0m\n`);
process.exit(ko ? 1 : 0);
