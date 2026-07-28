/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — KEY FORM · scénario
   ─────────────────────────────────────────────────────────────
   ~42 s : mes formulaires → le constructeur (champs, options) →
   la palette de types → publication (URL partageable) →
   les réponses reçues.
   ⚠️ pad PROD-CRITIQUE (artistes) — la scène ne fait que LIRE
   des stubs, aucun appel réel.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Key Form',
  subtitle: 'Le formulaire intelligent — une URL à partager, les réponses qui arrivent',
  iconName: 'pulsa',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3100,  caption: 'Vos formulaires, et les réponses déjà reçues' },
  { at: 3300,  moveTo: '[data-act="open-form"][data-id="pul_demo1"]', dur: 700 },

  { at: 7100,  caption: 'Ouvrez-en un : le constructeur, champ par champ' },
  { at: 7300,  click: '[data-act="open-form"][data-id="pul_demo1"]' },
  { at: 7400,  waitFor: '.pulsa-field' },

  { at: 8200,  caption: 'Cliquez un champ pour régler ses options' },
  { at: 8400,  moveTo: '.pulsa-field', dur: 700 },
  { at: 9200,  click: '.pulsa-field' },

  { at: 14200, caption: 'Dix-sept types de champs : texte, choix, fichier, signature…' },
  { at: 14400, moveTo: '[data-act="open-field-menu"]', dur: 700 },
  { at: 15200, click: '[data-act="open-field-menu"]' },

  { at: 20200, run: (d) => d.querySelector('[data-act="close-modal"]')?.click() },

  { at: 20600, caption: 'Publiez : vous obtenez une adresse à partager' },
  { at: 20800, moveTo: '[data-act="goto"][data-step="publish"]', dur: 700 },
  { at: 21600, click: '[data-act="goto"][data-step="publish"]' },

  { at: 27600, caption: 'Et les réponses arrivent, prêtes à exporter' },
  { at: 27800, run: (d) => d.querySelector('[data-act="back-to-library"]')?.click() },
  { at: 28600, click: '[data-act="view-responses"][data-id="pul_demo1"]' },

  { at: 35600, caption: 'Un formulaire pro, sans abonnement à un service tiers' },

  { at: 39400, outro: { dur: 2800 } },
];
