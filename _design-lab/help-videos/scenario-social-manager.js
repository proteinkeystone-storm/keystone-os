/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — SOCIAL MANAGER · scénario
   ─────────────────────────────────────────────────────────────
   ~41 s : composer une fois → les garde-fous par réseau →
   programmer → la file de publication → les comptes connectés.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Social Manager',
  subtitle: 'Composez une fois, publiez partout — Facebook, Instagram, LinkedIn…',
  iconName: 'user',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Écrivez votre message une seule fois' },
  { at: 3300,  moveTo: 'textarea', dur: 700 },

  { at: 8100,  caption: 'Choisissez les réseaux — chacun a ses règles, elles sont vérifiées' },
  { at: 8300,  moveTo: '.sm-net.is-on', dur: 700 },

  { at: 13600, caption: 'Programmez pour plus tard, ou publiez tout de suite' },
  { at: 13800, moveTo: '[data-act="toggle-schedule"]', dur: 700 },
  { at: 14600, click: '[data-act="toggle-schedule"]' },

  { at: 20100, caption: 'Votre file : ce qui part, ce qui est déjà parti' },
  { at: 20300, scrollTo: '.sm-queue' },
  { at: 20500, moveTo: '.sm-queue', dur: 800 },

  { at: 26500, caption: 'Et l’état de vos comptes connectés, en un coup d’œil' },
  { at: 26700, moveTo: '[data-act="open-connect"]', dur: 700 },
  { at: 27500, click: '[data-act="open-connect"]' },

  { at: 34000, caption: 'Une publication, tous vos réseaux — sans copier-coller' },

  { at: 37800, outro: { dur: 2800 } },
];
