/* ═══════════════════════════════════════════════════════════════
   Banc — Licence GRATUITE en self-service (POST /api/licence/free)
   ─────────────────────────────────────────────────────────────
   Ce que ce banc protège : le sac d'une licence gratuite vaut `[]`,
   JAMAIS `null`. Les deux se ressemblent en base et se comportent à
   l'OPPOSÉ — `null` est la sentinelle historique « accès TOTAL ».
   Une inversion ici offrirait les 14 applications à chaque visiteur
   qui prend l'offre à 0 €, sans qu'aucun test d'UI ne s'en aperçoive.

   Lancement : node scripts/test-licence-free.mjs   (inclus dans npm test)
   ═══════════════════════════════════════════════════════════════ */

import { bagAllows }                        from '../workers/src/lib/app-access.js';
import { quotaForEntitlements, hasPaidApp } from '../workers/src/lib/pricing-grid.js';
import { readFileSync }                     from 'node:fs';

let ok = 0, ko = 0;
const G = s => `\x1b[32m${s}\x1b[0m`, R = s => `\x1b[31m${s}\x1b[0m`;
function t(nom, réel, attendu) {
  const pass = JSON.stringify(réel) === JSON.stringify(attendu);
  pass ? ok++ : ko++;
  console.log(`  ${pass ? G('✓') : R('✗')} ${nom}` + (pass ? '' : R(`  attendu ${JSON.stringify(attendu)}, reçu ${JSON.stringify(réel)}`)));
}

const GRATUITES = [['O-SEC-001', 'Missive'], ['O-BOK-001', 'booK'], ['O-Keyn-001', 'Keynapse']];
const PAYANTES  = [['A-COM-005', 'Ghost Writer 19€'], ['A-COM-001', 'Smart QR 49€'], ['O-AGT-001', 'Smart Agent 99€']];
const LIBRE     = { plan: 'PRO', ownedAssets: [] };     // ce que crée la route

console.log('\n\x1b[1m▶ Suite 1 — une licence à sac VIDE ouvre exactement le palier gratuit\x1b[0m');
for (const [id, nom] of GRATUITES) t(`${nom} ouvert`, bagAllows({ ...LIBRE, appId: id }), true);
for (const [id, nom] of PAYANTES)  t(`${nom} fermé`,  bagAllows({ ...LIBRE, appId: id }), false);
t('0 conversation incluse',        quotaForEntitlements(LIBRE), 0);
t('dictée Keynapse refusée',       hasPaidApp(LIBRE), false);

console.log('\n\x1b[1m▶ Suite 2 — le piège : sac NULL = accès TOTAL, jamais pour une gratuite\x1b[0m');
const NUL = { plan: 'PRO', ownedAssets: null };
for (const [id, nom] of PAYANTES) t(`${nom} ouvert avec null (sentinelle legacy)`, bagAllows({ ...NUL, appId: id }), true);
t('quota illimité avec null', quotaForEntitlements(NUL), null);

console.log('\n\x1b[1m▶ Suite 3 — la route écrit bien \'[]\' et pas autre chose\x1b[0m');
const src = readFileSync(new URL('../workers/src/routes/licence-free.js', import.meta.url), 'utf8');
t("l'INSERT porte owned_assets = '[]'", /owned_assets[\s\S]{0,200}?'\[\]'/.test(src) || src.includes("1, '[]'"), true);
t('aucun INSERT ne pose owned_assets à NULL', /owned_assets\s*=?\s*NULL/i.test(src), false);
t('la clé est renvoyée à l’appelant (activation sans attente d’e-mail)', src.includes('key,') && src.includes('activateUrl'), true);
t('un e-mail déjà porteur d’une licence payante est refusé (409)', src.includes('409'), true);
t('garde anti-abus par IP présente', src.includes('CF-Connecting-IP'), true);

console.log(`\n${ok + ko} tests — ${ko ? R(ko + ' ko') : G(ok + ' ok')}${ko ? R(`, ${ok} ok`) : ', 0 ko'}\n`);
process.exit(ko ? 1 : 0);
