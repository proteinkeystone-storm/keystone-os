#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// Livrer un asset à un client — tests unitaires (logique PURE)
// ───────────────────────────────────────────────────────────────────
// Couvre validateTransferInput + computeReceptionWarnings, extraites de
// handleAssetTransfer. Aucune I/O, aucun D1, aucun réseau.
//   node scripts/test-asset-transfer.mjs
// ══════════════════════════════════════════════════════════════════
import {
  validateTransferInput,
  computeReceptionWarnings,
  TOOL_BY_TYPE,
} from '../workers/src/routes/asset-transfer.js';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m' };
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ${C.red}✗ FAIL:${C.reset} ${label}`); }
}

const QR = TOOL_BY_TYPE.qr;       // A-COM-001
const KF = TOOL_BY_TYPE.keyform;  // A-COM-004

// ── validateTransferInput ──────────────────────────────────────────

// 1. QR valide
let v = validateTransferInput({ type: 'qr', id: 'ent-123', target_email: 'Client@Agence.FR' });
assert(v.ok && v.type === 'qr' && v.id === 'ent-123' && v.email === 'client@agence.fr' && v.dryRun === false,
  '1. QR valide : email normalisé minuscule, dryRun=false par défaut');

// 2. Key Form valide
v = validateTransferInput({ type: 'KeyForm', id: 'pul_9', target_email: 'a@b.fr' });
assert(v.ok && v.type === 'keyform', '2. type insensible à la casse → keyform');

// 3. type inconnu → 400
v = validateTransferInput({ type: 'banana', id: 'x', target_email: 'a@b.fr' });
assert(!v.ok && v.status === 400, '3. type inconnu → refus 400');

// 4. id manquant → 400
v = validateTransferInput({ type: 'qr', id: '   ', target_email: 'a@b.fr' });
assert(!v.ok && v.status === 400, '4. id vide → refus 400');

// 5. email invalide → 400
v = validateTransferInput({ type: 'qr', id: 'x', target_email: 'pas-un-email' });
assert(!v.ok && v.status === 400, '5. email invalide → refus 400');

// 6. dry_run accepté sous plusieurs formes
v = validateTransferInput({ type: 'qr', id: 'x', target_email: 'a@b.fr', dry_run: true });
assert(v.ok && v.dryRun === true, '6a. dry_run=true → dryRun true');
v = validateTransferInput({ type: 'qr', id: 'x', target_email: 'a@b.fr', dry_run: '1' });
assert(v.ok && v.dryRun === true, '6b. dry_run="1" → dryRun true');
v = validateTransferInput({ type: 'qr', id: 'x', target_email: 'a@b.fr', dry_run: false });
assert(v.ok && v.dryRun === false, '6c. dry_run=false → dryRun false');

// 7. body vide / non-objet → 400 (pas de crash)
assert(validateTransferInput(undefined).ok === false, '7a. body undefined → refus sans crash');
assert(validateTransferInput({}).ok === false, '7b. body {} → refus');

// ── computeReceptionWarnings ───────────────────────────────────────

// 8. owned_assets = null (MAX/ADMIN/Stripe) → accès total, AUCUN warning
let w = computeReceptionWarnings({ ownedAssets: null, toolId: QR, currentTenant: 'default', targetTenant: 'cli1' });
assert(w.length === 0, '8. owned_assets=null → aucun avertissement (accès total)');

// 9. owned_assets liste SANS l'outil → plan_excludes_tool
w = computeReceptionWarnings({ ownedAssets: ['A-COM-002'], toolId: QR, currentTenant: 'default', targetTenant: 'cli1' });
assert(w.includes('plan_excludes_tool') && !w.includes('already_owned'),
  '9. liste sans l\'outil → plan_excludes_tool');

// 10. owned_assets liste AVEC l'outil → aucun warning
w = computeReceptionWarnings({ ownedAssets: [QR, 'A-COM-002'], toolId: QR, currentTenant: 'default', targetTenant: 'cli1' });
assert(w.length === 0, '10. liste incluant l\'outil → aucun avertissement');

// 11. asset déjà chez le tenant cible → already_owned
w = computeReceptionWarnings({ ownedAssets: null, toolId: KF, currentTenant: 'cli1', targetTenant: 'cli1' });
assert(w.includes('already_owned'), '11. même tenant source/cible → already_owned');

// 12. cumul : déjà possédé ET plan sans l'outil
w = computeReceptionWarnings({ ownedAssets: ['A-COM-009'], toolId: KF, currentTenant: 'cli1', targetTenant: 'cli1' });
assert(w.includes('already_owned') && w.includes('plan_excludes_tool'),
  '12. cumul already_owned + plan_excludes_tool');

// 13. tenants partiels (null) → pas de faux already_owned
w = computeReceptionWarnings({ ownedAssets: null, toolId: QR, currentTenant: null, targetTenant: 'cli1' });
assert(!w.includes('already_owned'), '13. currentTenant null → pas de faux already_owned');

// ── Résumé ─────────────────────────────────────────────────────────
const total = pass + fail;
if (fail === 0) {
  console.log(`${C.green}${C.bold}✓ ${pass}/${total} PASS${C.reset} — Livrer un asset à un client (validation + avertissements)`);
  process.exit(0);
} else {
  console.error(`${C.red}${C.bold}✗ ${fail}/${total} FAIL${C.reset} — Livrer un asset à un client`);
  process.exit(1);
}
