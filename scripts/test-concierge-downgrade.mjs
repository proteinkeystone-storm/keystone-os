#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// Auto-dégradation Concierge à l'échéance — tests unitaires (PURE)
// ───────────────────────────────────────────────────────────────────
// Couvre shouldDowngradeConcierge (sélection des QR à dégrader). La
// logique de conversion elle-même (smart→dynamic, garde-fou URL) est
// déjà couverte par test-qr-convert.mjs (evaluateModeConversion).
//   node scripts/test-concierge-downgrade.mjs
// ══════════════════════════════════════════════════════════════════
import { shouldDowngradeConcierge } from '../workers/src/routes/concierge-downgrade.js';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m' };
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ${C.red}✗ FAIL:${C.reset} ${label}`); }
}

// 1. Concierge smart avec short_id → à dégrader
assert(shouldDowngradeConcierge({ mode: 'smart', template_id: 'concierge', short_id: 'ab12cd34' }) === true,
  '1. Concierge smart + short_id → true');

// 2. Smart mais pas Concierge (storytelling) → non (coûte 0 IA)
assert(shouldDowngradeConcierge({ mode: 'smart', template_id: 'storytelling-brand', short_id: 'x' }) === false,
  '2. smart non-concierge → false');

// 3. Déjà en dynamic → non (idempotent)
assert(shouldDowngradeConcierge({ mode: 'dynamic', template_id: 'concierge', short_id: 'x' }) === false,
  '3. concierge déjà dynamic → false');

// 4. Statique → non
assert(shouldDowngradeConcierge({ mode: 'static', template_id: 'concierge', short_id: 'x' }) === false,
  '4. concierge static → false');

// 5. Concierge smart SANS short_id → non (pas de redirection à servir)
assert(shouldDowngradeConcierge({ mode: 'smart', template_id: 'concierge' }) === false,
  '5. concierge smart sans short_id → false');

// 6. short_id vide → non
assert(shouldDowngradeConcierge({ mode: 'smart', template_id: 'concierge', short_id: '' }) === false,
  '6. short_id vide → false');

// 7. machine-a-sous smart (jeu, 0 IA) → non
assert(shouldDowngradeConcierge({ mode: 'smart', template_id: 'machine-a-sous', short_id: 'x' }) === false,
  '7. jeu smart → false');

// 8. data null / non-objet → non (pas de crash)
assert(shouldDowngradeConcierge(null) === false, '8a. null → false');
assert(shouldDowngradeConcierge(undefined) === false, '8b. undefined → false');
assert(shouldDowngradeConcierge({}) === false, '8c. {} → false');

// 9. mode/template absents → non
assert(shouldDowngradeConcierge({ short_id: 'x' }) === false, '9. mode/template absents → false');

// ── Résumé ─────────────────────────────────────────────────────────
const total = pass + fail;
if (fail === 0) {
  console.log(`${C.green}${C.bold}✓ ${pass}/${total} PASS${C.reset} — auto-dégradation Concierge (sélection)`);
  process.exit(0);
} else {
  console.error(`${C.red}${C.bold}✗ ${fail}/${total} FAIL${C.reset} — auto-dégradation Concierge`);
  process.exit(1);
}
