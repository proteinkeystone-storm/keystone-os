/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — KEY BRAND (pad O-BRD-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~43 s : mes chartes → couleurs → typographies → les règles
   (les interdits auto-générés) → les supports en situation →
   le lien public à partager.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Key Brand',
  subtitle: 'Votre charte graphique vivante — à jour, partageable d’un lien',
  iconName: 'keybrand',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Vos chartes — une par marque, une par client' },
  { at: 3300,  moveTo: '.kb-card[data-id="c1"]', dur: 800 },

  { at: 7300,  caption: 'Ouvrez-en une' },
  { at: 7500,  moveTo: '.kb-card[data-id="c1"] [data-act="open"]', dur: 700 },
  { at: 8300,  click: '.kb-card[data-id="c1"] [data-act="open"]' },
  { at: 8400,  waitFor: '[data-act="tab-colors"]' },

  { at: 9200,  caption: 'Les couleurs, avec leurs codes prêts à copier' },
  { at: 9400,  click: '[data-act="tab-colors"]' },

  { at: 15400, caption: 'Les typographies, affichées dans leur vraie police' },
  { at: 15600, moveTo: '[data-act="tab-type"]', dur: 700 },
  { at: 16400, click: '[data-act="tab-type"]' },

  { at: 22400, caption: 'Les règles : ce qu’on fait — et surtout ce qu’on ne fait pas' },
  { at: 22600, moveTo: '[data-act="tab-rules"]', dur: 700 },
  { at: 23400, click: '[data-act="tab-rules"]' },

  { at: 29400, caption: 'Et vos supports, composés automatiquement' },
  { at: 29600, moveTo: '[data-act="tab-supports"]', dur: 700 },
  { at: 30400, click: '[data-act="tab-supports"]' },

  { at: 36400, caption: 'Un lien à envoyer : votre imprimeur et votre graphiste ont tout' },

  { at: 40200, outro: { dur: 2800 } },
];
