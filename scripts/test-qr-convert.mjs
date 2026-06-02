#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════
// Conversion de mode QR (Concierge ↔ redirection) — tests unitaires
// ───────────────────────────────────────────────────────────────────
// Couvre evaluateModeConversion (logique PURE extraite de handleUpdateQr) :
// sens autorisés, garde-fou « URL joignable obligatoire », gate IA du retour,
// idempotence, fallback template, types non-URL. Aucune I/O, aucun D1, aucun
// réseau → gate du sprint : ce fichier vert + `node --check`.
//
//   node scripts/test-qr-convert.mjs
// ══════════════════════════════════════════════════════════════════
import { evaluateModeConversion } from '../workers/src/routes/qr.js';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m' };
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ${C.red}✗ FAIL:${C.reset} ${label}`); }
}

const URL_A = 'https://agence-horizon.fr/programme';
const URL_B = 'https://agence-horizon.fr/contact';

// 1. smart → dynamic : réutilise la cible existante valide du Concierge.
let r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(r.ok && !r.noop && r.newMode === 'dynamic' && r.effectiveTargetUrl === URL_A,
  '1. smart→dynamic réutilise la cible existante');

// 2. smart → dynamic : une nouvelle URL fournie est prioritaire.
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'url', smartAllowed: true,
  newTargetUrl: URL_B, newTargetUrlValid: true,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(r.ok && r.effectiveTargetUrl === URL_B, '2. smart→dynamic prend la nouvelle URL fournie');

// 3. smart → dynamic SANS aucune URL joignable → refus 400 (jamais de redirection cassée).
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: null, existingTargetUrlValid: false, hasTemplate: true,
});
assert(!r.ok && r.status === 400, '3. smart→dynamic sans URL valide → refus 400');

// 4. URL fournie invalide → refus 400 (même si l'existante était bonne).
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'url', smartAllowed: true,
  newTargetUrl: 'ftp://nope', newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(!r.ok && r.status === 400, '4. URL fournie invalide → refus 400');

// 5. dynamic → smart autorisé (admin / licence OK) : conserve le template.
r = evaluateModeConversion({
  currentMode: 'dynamic', targetModeRaw: 'smart', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(r.ok && r.newMode === 'smart' && !r.fallbackTemplate, '5. dynamic→smart autorisé conserve le template');

// 6. dynamic → smart refusé (pas de droit IA) → refus 403.
r = evaluateModeConversion({
  currentMode: 'dynamic', targetModeRaw: 'smart', qrType: 'url', smartAllowed: false,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(!r.ok && r.status === 403, '6. dynamic→smart sans droit IA → refus 403');

// 7. static → quoi que ce soit → refus 400 (pas de short_id à rediriger).
r = evaluateModeConversion({
  currentMode: 'static', targetModeRaw: 'dynamic', qrType: 'url', smartAllowed: true,
  newTargetUrl: URL_A, newTargetUrlValid: true,
  existingTargetUrl: null, existingTargetUrlValid: false, hasTemplate: false,
});
assert(!r.ok && r.status === 400, '7. static→* impossible → refus 400');

// 8. mode cible inconnu → refus 400.
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'banana', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(!r.ok && r.status === 400, '8. mode cible inconnu → refus 400');

// 9. même mode → no-op idempotent, sans erreur ni écriture.
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'smart', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: true,
});
assert(r.ok && r.noop && r.newMode === 'smart', '9. même mode → no-op sans erreur');

// 10. dynamic → smart sans template préservé → fallback storytelling.
r = evaluateModeConversion({
  currentMode: 'dynamic', targetModeRaw: 'smart', qrType: 'url', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: URL_A, existingTargetUrlValid: true, hasTemplate: false,
});
assert(r.ok && r.newMode === 'smart' && r.fallbackTemplate === true, '10. dynamic→smart sans template → fallback');

// 11. smart → dynamic type non-URL (vcard) : aucune URL requise.
r = evaluateModeConversion({
  currentMode: 'smart', targetModeRaw: 'dynamic', qrType: 'vcard', smartAllowed: true,
  newTargetUrl: null, newTargetUrlValid: false,
  existingTargetUrl: null, existingTargetUrlValid: false, hasTemplate: true,
});
assert(r.ok && r.newMode === 'dynamic' && r.effectiveTargetUrl === null,
  "11. smart→dynamic non-URL : pas d'URL requise");

// ── Résumé ────────────────────────────────────────────────────────
const total = pass + fail;
if (fail === 0) {
  console.log(`${C.green}${C.bold}✓ ${pass}/${total} PASS${C.reset} — conversion de mode QR (Concierge ↔ redirection)`);
  process.exit(0);
} else {
  console.error(`${C.red}${C.bold}✗ ${fail}/${total} FAIL${C.reset} — conversion de mode QR`);
  process.exit(1);
}
