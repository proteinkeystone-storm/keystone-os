/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — SMART AGENT (pad O-AGT-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~30 s : mes agents → le savoir (fiches) → tester en direct
   (réponse sourcée) → les trous (il avoue ce qu'il ignore).
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Smart Agent',
  subtitle: 'Le jumeau numérique de votre savoir-faire — il répond sans rien inventer',
  iconName: 'smart-agent',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3050,  caption: 'Votre agent répond à vos clients — avec VOTRE savoir-faire' },
  { at: 3200,  moveTo: '[data-act="ag-open"]', dur: 900 },
  { at: 4600,  click: '[data-act="ag-open"]' },

  { at: 5300,  caption: 'Son savoir : vos fiches — faits, réponses, procédures, règles' },
  { at: 5500,  moveTo: '[data-act="kx-edit"]', dur: 900 },

  { at: 8300,  caption: 'Testez-le comme le ferait un client' },
  { at: 8500,  moveTo: '[data-act="tab"][data-tab="tester"]', dur: 800 },
  { at: 9400,  click: '[data-act="tab"][data-tab="tester"]' },

  { at: 9900,  moveTo: '[data-slot="chat-text"]', dur: 700 },
  { at: 10700, click: '[data-slot="chat-text"]' },
  { at: 10900, type: { sel: '[data-slot="chat-text"]', text: 'Réparez-vous les lampes anciennes ?', cps: 13 } },

  { at: 13800, moveTo: '[data-act="chat-send"]', dur: 600 },
  { at: 14500, click: '[data-act="chat-send"]' },
  { at: 14600, waitFor: '.sa-srcref' },

  { at: 15100, caption: 'Il répond avec VOS mots — et cite sa source' },
  { at: 15300, moveTo: '.sa-srcref', dur: 900 },

  { at: 18300, caption: 'Ce qu’il ne sait pas, il l’avoue — et vous le signale' },
  { at: 18500, moveTo: '[data-act="tab"][data-tab="trous"]', dur: 800 },
  { at: 19400, click: '[data-act="tab"][data-tab="trous"]' },

  { at: 20200, moveTo: '[data-act="gap-answer"]', dur: 900 },
  { at: 22200, caption: 'Une fiche pour combler le trou — et il saura répondre' },

  { at: 24600, outro: { dur: 2600 } },
];
