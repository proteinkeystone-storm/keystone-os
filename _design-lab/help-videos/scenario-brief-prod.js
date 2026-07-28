/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — BRIEF PROD (pad A-COM-002) · scénario
   ─────────────────────────────────────────────────────────────
   ~44 s : le support et son imprimeur → l'aperçu vivant du
   gabarit → le message → le brief PDF + le KIT de fichiers aux
   normes (l'argument massue, vue « output »).
   ⚠️ l'état actif est marqué par la classe `ws-btn--accent`,
   pas `is-active` ; le kit vit dans la vue output.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Brief Prod',
  subtitle: 'Le brief créatif infaillible — et les fichiers aux normes de votre imprimeur',
  iconName: 'kodex',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Choisissez votre support — ici, un dépliant A4' },
  { at: 3300,  moveTo: '[data-act="dest-support"].ws-btn--accent', dur: 700 },

  { at: 7100,  caption: 'Votre imprimeur : Brief Prod connaît ses normes exactes' },
  { at: 7300,  moveTo: '[data-act="dest-vendor"].ws-btn--accent', dur: 700 },

  { at: 11100, caption: 'Un pliage ? Volets et plis sont calculés pour vous' },
  { at: 11300, moveTo: '[data-act="dest-fold"].ws-btn--accent', dur: 700 },

  { at: 15100, caption: 'À droite, l’aperçu vivant du gabarit : coupe, fond perdu, plis' },
  { at: 15300, moveTo: 'aside svg', dur: 800 },

  { at: 20100, caption: 'Étape suivante : votre message' },
  { at: 20300, moveTo: '[data-act="next"]', dur: 700 },
  { at: 21100, click: '[data-act="next"]' },

  { at: 21900, caption: 'Projet, lieu, échéance, argumentaire — tout est cadré' },

  { at: 27900, caption: 'Au bout : le brief PDF que votre graphiste ne peut pas mal lire' },
  { at: 28100, moveTo: '[data-act="goto"][data-step="output"]', dur: 700 },
  { at: 28900, click: '[data-act="goto"][data-step="output"]' },
  { at: 29000, waitFor: '[data-act="download-kit"]' },

  { at: 33500, caption: 'Et le kit de fichiers : PDF et PSD prêts, aux cotes exactes' },
  { at: 33700, scrollTo: '[data-act="download-kit"]' },
  { at: 33900, moveTo: '[data-act="download-kit"]', dur: 800 },

  { at: 39500, caption: 'Le brief ET le fichier de départ — impossible de se tromper' },

  { at: 43300, outro: { dur: 2800 } },
];
