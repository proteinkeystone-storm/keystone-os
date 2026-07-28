/* ═══════════════════════════════════════════════════════════════
   Vidéo d'aide — GHOST WRITER · scénario v2
   ─────────────────────────────────────────────────────────────
   Retour Stéphane (28/07) : actions trop lentes, et le CORRECTEUR
   (texte ET PDF) manquait — c'est pourtant la moitié du pad.
   v2 : gestes vifs (moveTo ~700 ms), pauses de lecture conservées,
   et les deux correcteurs montrés en vrai. ~50 s.

   ⚠️ Grammalecte tourne PARFAITEMENT en headless (25 ms) — la note
   du harnais notice prétendant le contraire était fausse.
   ═══════════════════════════════════════════════════════════════ */

export const meta = {
  name: 'Ghost Writer',
  subtitle: 'Réécrivez, puis corrigez — vos textes et même vos PDF',
  iconName: 'ghostwriter',
};

export const steps = [
  { at: 0,     intro: { dur: 3000 } },

  // ── 1. Réécriture ───────────────────────────────────────────
  { at: 3100,  caption: 'Collez votre texte — ici, une relance client' },
  { at: 3300,  moveTo: 'textarea', dur: 700 },

  { at: 6600,  caption: 'Un clic — trois réécritures calibrées' },
  { at: 6800,  moveTo: '[data-act="generate"]', dur: 700 },
  { at: 7600,  click: '[data-act="generate"]' },

  { at: 8400,  caption: 'Fidèle, concise ou chaleureuse — vous choisissez' },

  { at: 13400, caption: 'Le panneau Ω : les symboles introuvables au clavier' },
  { at: 13600, moveTo: '[data-act="symbols"]', dur: 700 },
  { at: 14400, click: '[data-act="symbols"]' },
  { at: 14700, run: (d) => d.querySelector('.ksym-chip[data-view="arrows"]')?.click() },

  { at: 18200, run: (d) => d.querySelector('.ksym-x')?.click() },

  // ── 2. Correcteur — TEXTE ───────────────────────────────────
  { at: 18600, caption: 'Deuxième moitié du pad : le Correcteur' },
  { at: 18800, moveTo: '[data-act="open-corrector"]', dur: 700 },
  { at: 19600, click: '[data-act="open-corrector"]' },
  { at: 19700, waitFor: '[data-act="analyze"]' },

  { at: 20400, caption: 'Orthographe, grammaire, accords — corrigés dans votre navigateur' },
  { at: 20600, moveTo: '[data-act="analyze"]', dur: 700 },
  { at: 21400, click: '[data-act="analyze"]' },

  { at: 22400, caption: 'Chaque faute est surlignée, avec ses corrections proposées' },

  // ── 3. Correcteur — PDF (l'argument massue) ─────────────────
  { at: 27400, caption: 'Et surtout : vos PDF, corrigés directement sur la page' },
  { at: 27600, moveTo: '.pf-tab[data-mode="pdf"]', dur: 700 },
  { at: 28400, click: '.pf-tab[data-mode="pdf"]' },

  { at: 29200, caption: 'Déposez un PDF — un devis, un courrier, une plaquette' },
  { at: 29400, run: async (d) => {
      const file = await window.__makeDemoPdf();
      const dt = new DataTransfer(); dt.items.add(file);
      const inp = d.querySelector('#pf-file');
      if (inp) { inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); }
    } },
  { at: 29500, waitFor: 'canvas' },

  { at: 32500, caption: 'Lancez la correction' },
  { at: 32700, moveTo: '[data-act="analyze"]', dur: 700 },
  { at: 33500, click: '[data-act="analyze"]' },

  { at: 35500, caption: 'Les fautes apparaissent SUR le document, page par page' },

  { at: 41500, caption: 'Réécrire, corriger, exporter — sans quitter Keystone' },

  { at: 45500, outro: { dur: 2800 } },
];
