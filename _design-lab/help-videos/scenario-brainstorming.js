/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — BRAINSTORMING (pad A-COM-003) · scénario
   ─────────────────────────────────────────────────────────────
   ~42 s : la question de départ → le comité de personnalités →
   le débat qui se joue → la synthèse qui TRANCHE.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Brainstorming',
  subtitle: '9 personnalités IA débattent de votre sujet — et la synthèse tranche',
  iconName: 'muse',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Posez votre question — un vrai sujet, pas un mot-clé' },
  { at: 3300,  moveTo: '#wr-input', dur: 700 },

  { at: 8100,  caption: 'Neuf personnalités : le pragmatique, la visionnaire, l’avocat du diable…' },
  { at: 8300,  moveTo: '.wr-rail-btn', dur: 700 },
  { at: 9100,  click: '.wr-rail-btn' },

  { at: 14100, run: (d) => d.querySelector('.wr-agents-close')?.click() },

  { at: 14500, caption: 'Ouvrez une séance déjà tenue' },
  { at: 14700, moveTo: '#wr-library-btn', dur: 700 },
  { at: 15500, click: '#wr-library-btn' },
  { at: 16000, click: '.wr-library-item[data-session-id="wr-demo-synthese"] .wr-library-item-body' },
  { at: 16100, waitFor: '.wr-synthesis-drawer' },

  { at: 17000, caption: 'Le débat se joue devant vous, tour après tour' },

  { at: 24000, caption: 'Chacun défend son angle — et se répond' },

  { at: 30000, caption: 'La synthèse ne résume pas : elle TRANCHE, et crédite qui a eu l’idée' },
  { at: 30200, scrollTo: '.wr-synthesis-drawer' },

  { at: 37500, caption: 'Une décision argumentée, en quelques minutes' },

  { at: 41300, outro: { dur: 2800 } },
];
