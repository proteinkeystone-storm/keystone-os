/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — SENTINEL (pad O-GEO-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~38 s, rythme POSÉ (règle Stéphane 28/07 : laisser le temps de
   lire et de voir chaque action) : sites surveillés → cockpit
   (score + En clair) → un correctif détaillé → visibilité IA
   (GEO, l'atout) → Search Console.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Sentinel',
  subtitle: 'Auditez et surveillez vos sites web — disponibilité, SEO, visibilité IA',
  iconName: 'sentinel',
};

export const steps = [
  { at: 0,     intro: { dur: 3200 } },

  { at: 3300,  caption: 'Vos sites surveillés en continu — état, vitesse, score' },
  { at: 3700,  moveTo: '[data-act="audit"]', dur: 1400 },

  { at: 8200,  caption: 'Ouvrez le bilan d’un site' },
  { at: 8700,  click: '[data-act="audit"]' },
  { at: 8800,  waitFor: 'details.snt-find' },

  { at: 9600,  caption: 'Un score global, cinq axes — et l’essentiel expliqué en clair' },

  { at: 15600, caption: 'Chaque problème vient avec sa marche à suivre, pas à pas' },
  { at: 16000, run: (d) => { const f = d.querySelector('details.snt-find'); if (f) f.setAttribute('open', ''); } },
  { at: 16300, scrollTo: 'details.snt-find' },
  { at: 16600, moveTo: 'details.snt-find .snt-find-h, details.snt-find summary', dur: 1100 },

  { at: 23600, caption: 'L’atout Sentinel : votre visibilité dans les IA (Gemini, ChatGPT…)' },
  { at: 24000, scrollTo: '#snt-geo-sec' },
  { at: 24300, moveTo: '#snt-geo-sec', dur: 1100 },

  { at: 31300, caption: 'Et vos vraies recherches Google, branchées sur la Search Console' },
  { at: 31700, scrollTo: '#snt-gsc-sec' },
  { at: 32000, moveTo: '#snt-gsc-sec', dur: 1100 },

  { at: 36800, outro: { dur: 2800 } },
];
