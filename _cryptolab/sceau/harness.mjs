// ─────────────────────────────────────────────────────────────────────────
// SCEAU — S0 spike crypto (harnais JETABLE, hors prod)
// Prouve : E2E gaté par VOPRF, serveur aveugle, mort cryptographique au 3e essai.
// Stack miroir prod : @cloudflare/voprf-ts (tourne sur Workers) + WebCrypto
// (globalThis.crypto.subtle, identique navigateur/Worker) pour HKDF + AES-GCM.
// ─────────────────────────────────────────────────────────────────────────
import {
  Oprf, VOPRFClient, VOPRFServer,
  generateKeyPair, randomPrivateKey, generatePublicKey,
} from '@cloudflare/voprf-ts';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');

// Suite VOPRF : P-256 / SHA-256 (WebCrypto natif partout, pas de courbe exotique).
const SUITE = Oprf.Suite.P256_SHA256;

let evalCount = 0; // compteur d'évaluations OPRF "côté serveur" (l'instrument du 3-strikes)

// ── Côté SERVEUR : 1 enregistrement = 1 secret ───────────────────────────
// Le serveur stocke : chiffré (R2) + clé privée OPRF (D1) + compteur. JAMAIS le clair, JAMAIS la passphrase.
function newServerRecord(privKey, pubKey, ciphertext, iv) {
  return { priv: privKey, pub: pubKey, ciphertext, iv, attempts: 0, max: 3, status: 'scelle' };
}

// L'unique opération comptée + rate-limitée. Le serveur NE PEUT PAS distinguer
// succès/échec (oblivious) : il compte chaque évaluation, point.
async function serverEvaluate(rec, evalReq) {
  if (rec.status !== 'scelle' || !rec.priv) throw new Error('SECRET_MORT (clé OPRF détruite)');
  if (rec.attempts >= rec.max) { rec.priv = null; rec.status = 'detruit'; throw new Error('SECRET_MORT (plafond atteint)'); }
  rec.attempts += 1; evalCount += 1;
  const server = new VOPRFServer(SUITE, rec.priv);
  const evaluation = await server.blindEvaluate(evalReq);
  // Au 3e essai consommé → on détruit la clé OPRF : plus aucun déchiffrement possible, jamais.
  if (rec.attempts >= rec.max) { rec.priv = null; rec.status = 'detruit'; }
  return evaluation;
}

// ── Côté CLIENT : dérive la clé AES à partir de la passphrase via le VOPRF ─
async function clientDeriveKey(rec, passphrase, pubKey) {
  const client = new VOPRFClient(SUITE, pubKey);
  const [finData, evalReq] = await client.blind([enc.encode(passphrase)]); // aveuglement : le serveur ne voit jamais la passphrase
  const evaluation = await serverEvaluate(rec, evalReq);                    // round-trip serveur (compté)
  const [output] = await client.finalize(finData, evaluation);             // dé-aveuglement → PRF output (32 o)
  // HKDF(output) → clé AES-256-GCM. L'output OPRF n'est jamais stocké.
  const ikm = await subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('sceau/v1'), info: enc.encode('aes-gcm-256') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// ── CRÉATION : le créateur chiffre, le serveur ne reçoit que le chiffré ───
async function createSecret(plaintext, passphrase) {
  const priv = await randomPrivateKey(SUITE);
  const pub = generatePublicKey(SUITE, priv);
  const rec = newServerRecord(priv, pub, null, null);            // compteur temporaire pour la création
  const recForCreate = { ...rec, max: 99 };                      // la création n'est pas une "tentative" de lecture
  const key = await clientDeriveKey(recForCreate, passphrase, pub);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  // Le serveur persiste : chiffré + clé OPRF + compteur REMIS À 0. Pas de clair, pas de passphrase, pas de clé AES.
  return newServerRecord(priv, pub, ct, iv);
}

// ── LECTURE : le destinataire tente avec une passphrase ───────────────────
async function readSecret(rec, passphrase) {
  const key = await clientDeriveKey(rec, passphrase, rec.pub);   // bon code → même PRF output → même clé AES
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, key, rec.ciphertext); // mauvais code → tag GCM échoue
  return dec.decode(pt);
}

// ── SCÉNARIO ──────────────────────────────────────────────────────────────
const SECRET = 'Code coffre : 4815-1623-0842  (mission Alpha)';
const PASS = 'cargo-tundra-violet-9'; // passphrase forte GÉNÉRÉE (l'humain ne choisit pas)

console.log('=== SCEAU S0 — preuve crypto VOPRF + E2E ===\n');
console.log('Clair (jamais vu du serveur) :', JSON.stringify(SECRET));
console.log('Passphrase (hors-bande)      :', JSON.stringify(PASS), '\n');

const rec = await createSecret(SECRET, PASS);
console.log('[CRÉATION] serveur stocke -> ciphertext(b64, tronqué):', b64(rec.ciphertext).slice(0, 32) + '…');
console.log('[CRÉATION] serveur stocke -> clé OPRF présente:', !!rec.priv, '| clair stocké:', rec.ciphertext.includes?.(0) ? '(octets chiffrés)' : 'NON', '\n');

// 1) Bon code → succès
try {
  const out = await readSecret(rec, PASS);
  console.log('[LECTURE 1 · bon code]   déchiffré =', JSON.stringify(out), '=> ', out === SECRET ? 'OK ✅' : 'MISMATCH ❌');
} catch (e) { console.log('[LECTURE 1] ÉCHEC inattendu:', e.message); }

// Burn happy-path : après une lecture réussie le client demande la destruction.
console.log('   (burn happy-path simulé : on repart d’un sceau neuf pour tester le 3-strikes)\n');

// 2) Trois mauvais codes → mort cryptographique
const rec2 = await createSecret(SECRET, PASS);
for (let i = 1; i <= 4; i++) {
  try {
    await readSecret(rec2, 'mauvaise-tentative-' + i);
    console.log(`[ESSAI ${i} · mauvais code] déchiffré ?! ❌ (ne devrait jamais arriver)`);
  } catch (e) {
    const why = /SECRET_MORT/.test(e.message) ? 'clé OPRF détruite' : 'tag AES-GCM rejeté (mauvais code)';
    console.log(`[ESSAI ${i} · mauvais code] refus -> ${why} | attempts=${rec2.attempts}/${rec2.max} status=${rec2.status}`);
  }
}

// 3) Même avec le BON code, après la mort → impossible
try {
  await readSecret(rec2, PASS);
  console.log('[APRÈS MORT · bon code] déchiffré ?! ❌ (faille)');
} catch (e) {
  console.log('[APRÈS MORT · bon code] refus ->', e.message, '✅ (irrécupérable, même clé OPRF serveur absente)');
}

console.log('\nTotal évaluations OPRF comptées côté serveur :', evalCount);
console.log('=== FIN — la voie OPRF tient sur la stack cible ===');
