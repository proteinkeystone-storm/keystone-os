/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — BOOK (pad O-BOK-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~40 s : l'étagère → l'éditeur (pages + aperçu vivant) →
   l'export HTML autoporté → le lecteur qui tourne les pages.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'booK',
  subtitle: 'Vos documents en flipbook — un seul fichier qui s’ouvre partout',
  iconName: 'book',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Votre étagère : chaque document devient un livre feuilletable' },
  { at: 3300,  moveTo: '.bk-card[data-id="bkdemo1"]', dur: 800 },

  { at: 8100,  caption: 'Ouvrez l’éditeur' },
  { at: 8300,  moveTo: '.bk-card[data-id="bkdemo1"] [data-act="edit"]', dur: 700 },
  { at: 9100,  click: '.bk-card[data-id="bkdemo1"] [data-act="edit"]' },
  { at: 9200,  waitFor: 'iframe' },

  { at: 10000, caption: 'Vos pages à gauche, l’aperçu vivant à droite' },

  { at: 16500, caption: 'Couverture, titre, couleurs — tout se règle ici' },

  { at: 22000, caption: 'Exportez : UN seul fichier HTML, sans rien à installer' },
  { at: 22200, scrollTo: ".bk-sec:last-of-type" },
  { at: 22600, run: (d) => d.querySelector('[data-act="refresh"]')?.click() },

  { at: 28500, caption: 'Il s’envoie par mail, se met en ligne, se lit hors connexion' },

  { at: 33500, caption: 'Et voilà le résultat, page après page' },
  { at: 33700, run: (d) => d.querySelector('[data-act="back"]')?.click() },
  { at: 34500, click: '.bk-card[data-id="bkdemo1"] [data-act="read"]' },

  { at: 38500, outro: { dur: 2800 } },
];
