/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — SMART DYNAMIC QR (pad A-COM-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~30 s : bibliothèque → créer en 3 étapes (type, contenu
   modifiable, apparence) → le QR créé, prêt à télécharger.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Smart Dynamic QR',
  subtitle: 'QR codes dynamiques · statistiques souveraines',
  iconName: 'sdqr',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  { at: 3050,  caption: 'Tous vos QR codes et leurs scans, au même endroit' },
  { at: 3200,  moveTo: '.sdqr-qr-card', dur: 900 },

  { at: 5400,  caption: 'Créez le vôtre en trois étapes' },
  { at: 5600,  moveTo: '#sdqr-new-btn', dur: 900 },
  { at: 6600,  click: '#sdqr-new-btn' },

  { at: 7100,  caption: '1 — Choisissez ce qu’il doit faire' },
  { at: 7300,  moveTo: '.sdqr-type-card[data-type="url"]', dur: 800 },
  { at: 8200,  click: '.sdqr-type-card[data-type="url"]' },

  { at: 9000,  caption: '2 — « Modifiable » : changez la destination même une fois imprimé' },
  { at: 9200,  moveTo: '.sdqr-modepick-btn[data-mode="dynamic"]', dur: 800 },
  { at: 10100, click: '.sdqr-modepick-btn[data-mode="dynamic"]' },

  { at: 10800, moveTo: '[data-payload-key="url"]', dur: 800 },
  { at: 11700, click: '[data-payload-key="url"]' },
  { at: 11900, run: (doc) => { const el = doc.querySelector('[data-payload-key="url"]'); if (el) el.value = ''; } },
  { at: 11950, type: { sel: '[data-payload-key="url"]', text: 'https://mon-site.fr/promo-ete', cps: 13 } },

  { at: 14500, moveTo: '#sdqr-f-name', dur: 700 },
  { at: 15300, click: '#sdqr-f-name' },
  { at: 15500, type: { sel: '#sdqr-f-name', text: 'Vitrine — Promo de l’été', cps: 13 } },

  { at: 17700, caption: '3 — L’apparence : couleurs, cadre, votre logo (facultatif)' },
  { at: 17900, scrollTo: '#sdqr-design-host' },

  { at: 19900, caption: 'L’aperçu à droite est votre QR, en direct' },
  { at: 20100, moveTo: '#sdqr-svg-wrap', dur: 900 },

  { at: 21900, caption: 'Créez — il est prêt' },
  { at: 22100, moveTo: '#sdqr-save', dur: 800 },
  { at: 23000, click: '#sdqr-save' },
  { at: 23100, waitFor: '#sdqr-save-url' },

  { at: 23600, caption: 'Téléchargez-le en PNG, SVG ou PDF — prêt pour l’imprimeur' },

  { at: 25800, caption: 'Ses scans arriveront dans l’onglet Statistiques' },
  { at: 26000, moveTo: '.sdqr-tab[data-view="stats"]', dur: 900 },

  { at: 28300, outro: { dur: 2600 } },
];
