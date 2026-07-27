/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — MISSIVE (pad O-SEC-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~21 s : écrire un secret → régler essais/expiration → sceller
   → lien + QR + code de déverrouillage. Voir tournage.js (DSL).
   Copy grand public : zéro jargon (cf. règle projet).
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Missive',
  subtitle: 'Transmettez un secret qui se lit une fois, puis s’autodétruit',
  iconName: 'sceau',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3050,  caption: 'Créez votre première missive' },
  { at: 3200,  moveTo: '.sceau-empty [data-act="new"]', dur: 900 },
  { at: 4200,  click: '.sceau-empty [data-act="new"]' },

  { at: 4500,  caption: 'Écrivez le secret à transmettre' },
  { at: 4600,  moveTo: '#sceau-secret', dur: 800 },
  { at: 5500,  click: '#sceau-secret' },
  { at: 5700,  type: { sel: '#sceau-secret', text: 'Le code du coffre est 4482#', cps: 11 } },

  { at: 8600,  caption: 'Réglez le nombre d’essais et la durée de vie' },
  { at: 8800,  moveTo: '#sceau-exp', dur: 800 },
  { at: 9700,  click: '#sceau-exp' },
  { at: 10000, select: { sel: '#sceau-exp', value: '86400' } },

  { at: 11200, caption: 'Scellez — le message est chiffré sur votre appareil' },
  { at: 11400, moveTo: 'form[data-form="create"] button[type="submit"]', dur: 900 },
  { at: 12500, click: 'form[data-form="create"] button[type="submit"]' },
  { at: 12600, waitFor: '.sceau-success' },

  { at: 13100, caption: 'Votre missive est prête : un lien à usage unique…' },
  { at: 13300, moveTo: '[data-act="copyurl"]', dur: 900 },
  { at: 14300, click: '[data-act="copyurl"]' },

  { at: 15500, caption: '…et son QR code, à imprimer ou partager' },
  { at: 15700, moveTo: '#sceau-qr', dur: 900 },

  { at: 17500, caption: 'Le code de déverrouillage se transmet par un AUTRE canal' },
  { at: 17700, moveTo: '.sceau-card.warn .sceau-code', dur: 900 },

  { at: 20000, caption: 'Une seule lecture — ensuite, la missive s’autodétruit' },

  { at: 21800, outro: { dur: 2600 } },
];
