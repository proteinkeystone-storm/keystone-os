/* ═══════════════════════════════════════════════════════════════
   Atelier vidéos d'aide — FAUX module voprf (tournage uniquement)
   ─────────────────────────────────────────────────────────────
   Le vrai bundle (app/vendor/sceau-voprf.esm.js) n'expose que le
   CLIENT — impossible de simuler le serveur OPRF avec la vraie
   arithmétique. Pour le tournage, ce module reproduit l'API que
   sceau.js consomme (Oprf.Suite, VOPRFClient.blind/finalize,
   Evaluation.deserialize) avec une sortie DÉTERMINISTE : le flux
   UI réel se déroule (chiffrement AES compris, sur une clé
   factice), rien ne part vers le worker de prod.
   Branché par l'import map de tournage-missive.html — le code de
   l'application n'est PAS modifié.
   ═══════════════════════════════════════════════════════════════ */

export const Oprf = {
  Suite: { P256_SHA256: 'P256-SHA256-FAKE' },
};

export class Evaluation {
  constructor(bytes) { this.bytes = bytes; }
  static deserialize(_suite, bytes) { return new Evaluation(bytes); }
}

export class VOPRFClient {
  constructor(_suite, _pub) {}
  async blind(inputs) {
    const fin = { inputs };
    const ereq = { serialize: () => new Uint8Array(32).fill(7) };
    return [fin, ereq];
  }
  async finalize(_fin, _evaluation) {
    // 32 octets déterministes — deviennent la clé AES du tournage.
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = (i * 37 + 11) & 0xFF;
    return [out];
  }
}
