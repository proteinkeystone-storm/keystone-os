/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — KEYNAPSE (pad O-Keyn-001) · scénario v2
   ─────────────────────────────────────────────────────────────
   Retour Stéphane (28/07) : 3 bulles suffisent, moins de
   mouvement, laisser le temps de LIRE la fiche. L'animation
   ambiante est coupée dans la scène (kn_motion=off) et les zooms
   se font PENDANT le carton d'intro (invisibles à l'écran).
   ~31 s, rythme posé.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Keynapse',
  subtitle: 'Vos idées en bulles vivantes — une constellation de notes qui vous suit',
  iconName: 'keynapse',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  // Avec 3 bulles, le cadrage automatique zoome déjà assez pour
  // afficher les titres — AUCUN zoom manuel (ça débordait).
  { at: 3050,  caption: 'Chaque idée est une bulle — reliée, rangée dans sa zone' },
  { at: 3300,  moveTo: 'g.kyn-bubble[data-bubble-id="b4"]', dur: 1400 },

  { at: 7000,  caption: 'Une idée qui passe ? Une bulle.' },
  { at: 7300,  moveTo: '[data-act="kyn-compose"]', dur: 1000 },
  { at: 8400,  click: '[data-act="kyn-compose"]' },
  { at: 8700,  click: '#kyn-new-title' },
  { at: 8900,  type: { sel: '#kyn-new-title', text: 'Idée mezzanine', cps: 10 } },
  { at: 10500, moveTo: '.kyn-composer [data-act="kyn-create"]', dur: 800 },
  { at: 11400, click: '.kyn-composer [data-act="kyn-create"]' },
  { at: 11500, waitFor: 'g.kyn-bubble[data-bubble-id="bnew"]' },

  { at: 12000, caption: 'Posée. Glissez-la où vous voulez, reliez-la aux autres' },
  { at: 12300, moveTo: 'g.kyn-bubble[data-bubble-id="bnew"]', dur: 1200 },

  { at: 15600, caption: 'Ouvrez une bulle : sa fiche contient tout' },
  { at: 15900, moveTo: 'g.kyn-bubble[data-bubble-id="b1"]', dur: 1200 },
  { at: 17200, click: 'g.kyn-bubble[data-bubble-id="b1"]' },
  { at: 17300, waitFor: '.kyn-panel' },
  { at: 17400, run: (d) => {
      [...d.querySelectorAll('.kyn-panel .kyn-sec-h')].forEach(h => {
        const t = h.textContent.trim(), s = h.closest('.kyn-sec');
        if (!s) return;
        if (t.startsWith('Captures')) s.id = 'film-sec-captures';
        if (t.startsWith('Rappels'))  s.id = 'film-sec-rappels';
      });
    } },

  // Temps de LECTURE : la fiche reste immobile, le curseur se pose
  { at: 18000, caption: 'Ses tâches et ses notes' },

  { at: 22000, caption: 'Ses photos, croquis et mémos vocaux' },
  { at: 22300, scrollTo: '#film-sec-captures' },
  { at: 22500, moveTo: '#film-sec-captures .kyn-sec-h', dur: 900 },

  { at: 26500, caption: 'Et ses rappels — Keynapse vous prévient au bon moment' },
  { at: 26800, scrollTo: '#film-sec-rappels' },
  { at: 27000, moveTo: '#film-sec-rappels .kyn-sec-h', dur: 900 },

  { at: 31000, outro: { dur: 2600 } },
];
