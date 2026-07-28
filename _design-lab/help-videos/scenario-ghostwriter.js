/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — GHOST WRITER · scénario
   ─────────────────────────────────────────────────────────────
   ~38 s, tempo posé : texte source (relance client) → générer →
   3 variantes calibrées → bibliothèque de symboles Ω.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Ghost Writer',
  subtitle: 'Réécrivez vos e-mails et textes — trois variantes calibrées, à votre main',
  iconName: 'ghostwriter',
};

export const steps = [
  { at: 0,     intro: { dur: 3200 } },

  { at: 3300,  caption: 'Collez votre texte — ici, une relance client à améliorer' },
  { at: 3700,  moveTo: 'textarea', dur: 1400 },

  { at: 9300,  caption: 'Un clic — Ghost Writer propose trois réécritures' },
  { at: 9700,  moveTo: '[data-act="generate"]', dur: 1200 },
  { at: 11000, click: '[data-act="generate"]' },

  { at: 12000, caption: 'Fidèle, concise ou chaleureuse — chacune est calibrée' },

  { at: 18500, caption: 'Copiez celle qui vous ressemble, ou gardez-la en bibliothèque' },

  { at: 24500, caption: 'Le panneau Ω : symboles et caractères introuvables au clavier' },
  { at: 24900, moveTo: '[data-act="symbols"]', dur: 1100 },
  { at: 26100, click: '[data-act="symbols"]' },
  { at: 26600, run: (d) => d.querySelector('.ksym-chip[data-view="arrows"]')?.click() },

  { at: 31600, caption: 'Un clic sur un symbole — il s’insère à votre curseur' },

  { at: 35400, outro: { dur: 2800 } },
];
