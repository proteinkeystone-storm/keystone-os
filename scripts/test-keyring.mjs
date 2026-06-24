// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Tests Key-Ring (Sonnette) · ORDRE 3
// ───────────────────────────────────────────────────────────────────
// Teste les helpers PURS du worker keyring.js (sanitize, dayKey, reponses,
// constantes anti-spam). La logique D1/push est integration (testee live).
// Exit 0 si tout PASS, 1 sinon.
// ══════════════════════════════════════════════════════════════════

import {
  sanitizeName, sanitizeMotif, dayKey,
  RING_RESPONSES, RING_COOLDOWN_S, RING_MAX_PER_DAY, KR_VERSION,
} from '../workers/src/routes/keyring.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label) { if (cond) pass++; else { fail++; fails.push(label); } }

// ── sanitizeName ──────────────────────────────────────────────
ok(sanitizeName('Marie Dupont') === 'Marie Dupont',                 'name: garde lettres + espace');
ok(sanitizeName('Léa O\'Brien 06') === 'Léa O\'Brien 06',            'name: garde accents, apostrophe, chiffres');
ok(sanitizeName('<script>x</script>') === 'scriptx/script',          'name: retire < et >');
ok(sanitizeName('  a   b  ') === 'a b',                              'name: collapse espaces + trim');
ok(sanitizeName('x'.repeat(60)).length === 40,                       'name: tronque a 40');
ok(sanitizeName(null) === '' && sanitizeName(undefined) === '',      'name: null/undefined -> vide');

// ── sanitizeMotif ─────────────────────────────────────────────
ok(sanitizeMotif('Livraison colis') === 'Livraison colis',          'motif: texte simple');
ok(sanitizeMotif('a<b>c') === 'abc',                                 'motif: retire angle brackets');
ok(sanitizeMotif('y'.repeat(200)).length === 140,                    'motif: tronque a 140');

// ── dayKey ────────────────────────────────────────────────────
ok(dayKey(Date.parse('2026-06-24T10:30:00Z')) === '2026-06-24',      'dayKey: YYYY-MM-DD UTC');
ok(/^\d{4}-\d{2}-\d{2}$/.test(dayKey(0)),                            'dayKey: format date');

// ── RING_RESPONSES ────────────────────────────────────────────
ok(['arrive', '5min', 'open', 'busy'].every(k => typeof RING_RESPONSES[k] === 'string' && RING_RESPONSES[k]),
                                                                     'reponses: 4 cles non vides');
ok(RING_RESPONSES['inconnu'] === undefined,                         'reponses: cle inconnue absente (rejet)');

// ── Constantes anti-spam ──────────────────────────────────────
ok(typeof RING_COOLDOWN_S === 'number' && RING_COOLDOWN_S > 0,       'cooldown: nombre positif');
ok(typeof RING_MAX_PER_DAY === 'number' && RING_MAX_PER_DAY > 0,     'plafond/jour: nombre positif');
ok(typeof KR_VERSION === 'string' && KR_VERSION,                     'version presente');

console.log(`\n  Key-Ring (Sonnette) — ${pass} PASS, ${fail} FAIL`);
if (fail) { console.log('  Echecs:\n   - ' + fails.join('\n   - ')); process.exit(1); }
process.exit(0);
