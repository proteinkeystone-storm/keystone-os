/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — NETWORK (pad O-NET-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~41 s : l'arbre relationnel → une catégorie qui se déplie →
   la fiche d'un contact → son journal → les relances dues.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'networK',
  subtitle: 'Votre réseau vivant — qui vous connaissez, et quand les relancer',
  iconName: 'network',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Votre réseau en arbre — vos contacts rangés par famille' },
  { at: 3300,  moveTo: '.nk-cat[data-cat="c1"]', dur: 800 },

  { at: 7600,  caption: 'Dépliez une branche' },
  { at: 7800,  click: '.nk-cat[data-cat="c1"]' },

  { at: 12300, caption: 'Chaque contact a sa fiche' },
  { at: 12500, moveTo: '.nk-person[data-id="p1"]', dur: 800 },
  { at: 13500, click: '.nk-person[data-id="p1"]' },
  { at: 13600, waitFor: '[data-act="nk-fiche-tab"]' },

  { at: 14300, caption: 'Ses coordonnées, son entreprise, ce qui vous relie' },

  { at: 20300, caption: 'Et son journal : chaque échange, daté' },
  { at: 20500, moveTo: '[data-act="nk-fiche-tab"][data-tab="activite"]', dur: 700 },
  { at: 21300, click: '[data-act="nk-fiche-tab"][data-tab="activite"]' },

  { at: 27300, caption: 'networK vous dit qui relancer — avant que le lien se refroidisse' },

  { at: 33300, caption: 'Un carnet d’adresses qui pense à votre place' },

  { at: 37100, outro: { dur: 2800 } },
];
