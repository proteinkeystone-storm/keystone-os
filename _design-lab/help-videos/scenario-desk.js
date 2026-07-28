/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — DESK (pad O-DSK-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~39 s, tempo posé (référence Sentinel) : chemin de fer →
   fiche d'une page (copie + pièces) → le marbre → le bac des
   contributions e-mail.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'desK',
  subtitle: 'Le chemin de fer vivant de votre revue — qui doit livrer quoi, et quand',
  iconName: 'desk',
};

export const steps = [
  { at: 0,     intro: { dur: 3200 } },

  { at: 3300,  caption: 'Votre numéro, page par page — le chemin de fer en direct' },
  { at: 3700,  moveTo: '.dk-pcard[data-n="17"]', dur: 1400 },

  { at: 9500,  caption: 'Ouvrez une page : son article, sa copie, ses pièces' },
  { at: 10000, click: '.dk-pcard[data-n="17"]' },

  { at: 17000, caption: 'Le marbre : tout ce qui est écrit, pas encore placé' },
  { at: 17400, moveTo: '[data-v="marbre"]', dur: 1100 },
  { at: 18600, click: '[data-v="marbre"]' },

  { at: 25600, caption: 'Les contributions arrivent par e-mail — desK les range presque seul' },
  { at: 26000, moveTo: '[data-act="bac"]', dur: 1100 },
  { at: 27200, click: '[data-act="bac"]' },

  { at: 33800, caption: 'Qui doit livrer quoi, quand — et quoi faire quand ça dérape' },

  { at: 37600, outro: { dur: 2800 } },
];
