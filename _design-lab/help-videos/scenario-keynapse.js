/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — KEYNAPSE (pad O-Keyn-001) · scénario
   ─────────────────────────────────────────────────────────────
   ~27 s : constellation → créer une bulle (≤ 14 caractères, le
   moteur tronque les titres longs) → ouvrir une fiche (notes,
   captures, tâches, rappels).
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Keynapse',
  subtitle: 'Vos idées en bulles vivantes — une constellation de notes qui vous suit',
  iconName: 'keynapse',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  // Zoom sémantique : les titres n'apparaissent qu'au-delà de k=0.95
  { at: 3050,  run: (d) => d.querySelector('[data-act="kyn-zoom-in"]')?.click() },
  { at: 3350,  run: (d) => d.querySelector('[data-act="kyn-zoom-in"]')?.click() },

  { at: 3450,  caption: 'Chaque idée est une bulle — reliées, rangées en zones' },
  { at: 3650,  moveTo: 'g.kyn-bubble[data-bubble-id="b4"]', dur: 1000 },

  { at: 6100,  caption: 'Une idée qui passe ? Une bulle.' },
  { at: 6300,  moveTo: '[data-act="kyn-compose"]', dur: 900 },
  { at: 7300,  click: '[data-act="kyn-compose"]' },
  { at: 7600,  click: '#kyn-new-title' },
  { at: 7800,  type: { sel: '#kyn-new-title', text: 'Idée mezzanine', cps: 12 } },
  { at: 9200,  moveTo: '.kyn-composer [data-act="kyn-create"]', dur: 700 },
  { at: 10000, click: '.kyn-composer [data-act="kyn-create"]' },
  { at: 10100, waitFor: 'g.kyn-bubble[data-bubble-id="bnew"]' },
  { at: 10200, run: (d) => d.querySelector('[data-act="kyn-zoom-in"]')?.click() },

  { at: 10600, caption: 'Posée. Glissez-la où vous voulez, reliez-la aux autres' },
  { at: 10800, moveTo: 'g.kyn-bubble[data-bubble-id="bnew"]', dur: 1000 },

  { at: 13300, caption: 'Ouvrez une bulle : sa fiche contient tout' },
  { at: 13500, moveTo: 'g.kyn-bubble[data-bubble-id="b1"]', dur: 1000 },
  { at: 14600, click: 'g.kyn-bubble[data-bubble-id="b1"]' },
  { at: 14700, waitFor: '.kyn-panel' },

  // L'ordre DOM des sections ≠ ordre visuel → on marque par TITRE.
  { at: 15200, run: (d) => {
      [...d.querySelectorAll('.kyn-panel .kyn-sec-h')].forEach(h => {
        const t = h.textContent.trim(), s = h.closest('.kyn-sec');
        if (!s) return;
        if (t.startsWith('Captures')) s.id = 'film-sec-captures';
        if (t.startsWith('Rappels'))  s.id = 'film-sec-rappels';
      });
    } },
  { at: 15400, caption: 'Notes, photos, croquis, mémos vocaux, tâches…' },
  { at: 15600, scrollTo: '#film-sec-captures' },
  { at: 15800, moveTo: '#film-sec-captures .kyn-sec-h', dur: 900 },

  { at: 18800, caption: '…et des rappels : Keynapse vous prévient au bon moment' },
  { at: 19000, scrollTo: '#film-sec-rappels' },
  { at: 19200, moveTo: '#film-sec-rappels .kyn-sec-h', dur: 900 },

  { at: 22200, caption: 'Vos idées restent vivantes — plus jamais perdues' },

  { at: 24200, outro: { dur: 2600 } },
];
