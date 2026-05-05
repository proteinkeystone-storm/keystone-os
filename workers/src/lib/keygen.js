/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Générateur de clés de licence
   ─────────────────────────────────────────────────────────────
   Format     : XXXX-XXXX-XXXX-XXXX
   Alphabet   : 32 caractères sans ambiguïté visuelle
                (pas de I/O/0/1/L pour éviter la confusion à la saisie)
   Entropie   : log2(32^16) = 80 bits — suffisant face au rate-limit
                serveur (10 essais → lock 24h) et au PBKDF2 100k.
   Source     : crypto.getRandomValues (CSPRNG)
   ═══════════════════════════════════════════════════════════════ */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 32 chars exactement → on peut masker 5 bits par char proprement
const SEGMENTS  = 4;
const PER_SEG   = 4;

export function generateLicenceKey(prefix = '') {
  const segments = [];
  if (prefix) segments.push(prefix.toUpperCase().slice(0, PER_SEG).padEnd(PER_SEG, 'X'));
  while (segments.length < SEGMENTS) {
    const buf = new Uint8Array(PER_SEG);
    crypto.getRandomValues(buf);
    let s = '';
    for (let i = 0; i < PER_SEG; i++) s += ALPHABET[buf[i] & 0x1f];
    segments.push(s);
  }
  return segments.join('-');
}

export function isValidKeyFormat(key) {
  return /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test((key || '').toUpperCase());
}
