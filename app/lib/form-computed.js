/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Form Computed Fields Engine (Sprint 4.2)
   Moteur générique d'auto-calculs déclaratifs sur formulaires de pads.

   Le pad déclare `computed_fields: [...]` en JSON. À chaque changement
   d'un champ source, le moteur :
     1. Lit les valeurs des champs `from`
     2. Calcule la valeur via la `recipe` enregistrée
     3. Écrit la valeur dans le champ `to` (input/select)

   Pattern "last-write-wins" : pas de tracking dirty sur la cible.
   L'utilisateur peut toujours surcharger en éditant la cible après
   la dernière modification d'un champ source.

   Recipes disponibles : voir RECIPES.

   Convention d'écriture dans pads-data.js :
     computed_fields: [
       { to: 'prix_ttc',  recipe: 'tva-multiply', from: ['prix_ht',  'tva_taux'] },
       { to: 'prix_ht',   recipe: 'tva-divide',   from: ['prix_ttc', 'tva_taux'] },
       { to: 'ech_hors_eau', recipe: 'percent',   from: ['prix_ttc'], factor: 0.70 },
       { to: 'depot_montant_lettres', recipe: 'number-to-french-words-eur', from: ['depot_montant'] },
     ]
   ═══════════════════════════════════════════════════════════════ */

// ── Helpers numeriques ─────────────────────────────────────────

function _num(value) {
  if (value === null || value === undefined) return NaN;
  const s = String(value).replace(/\s/g, '').replace(/,/g, '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// Extrait le taux numérique depuis un select TVA (ex: "20 %" → 0.20,
// "5,5 % (zone ANRU / PSLA)" → 0.055).
function _tvaRate(value) {
  if (!value) return NaN;
  const m = String(value).match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!m) return NaN;
  return parseFloat(m[1].replace(',', '.')) / 100;
}

// Arrondi à l'euro (les montants sont saisis en euros entiers dans A9).
function _round(n) { return Math.round(n); }

// ── Conversion nombre → mots français (pour montants en lettres) ──
// Couverture : 0 → 999 999 999. Convention française avec accords (ex:
// "quatre-vingts" mais "quatre-vingt-un", "deux cents" mais "deux cent un").

const _UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const _TEENS = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const _TENS  = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function _below100(n) {
  if (n < 10) return _UNITS[n];
  if (n < 20) return _TEENS[n - 10];
  const t = Math.floor(n / 10);
  const u = n % 10;
  // Plages spéciales : 70-79 et 90-99 (basées sur soixante/quatre-vingt + 10..19)
  if (t === 7 || t === 9) {
    const teen = _TEENS[u];
    const base = _TENS[t]; // "soixante" ou "quatre-vingt"
    return u === 0 ? base + '-dix' : base + '-' + teen;
  }
  // 80 : "quatre-vingts" (avec s final si seul)
  if (t === 8 && u === 0) return 'quatre-vingts';
  // Liaison "et" pour 21, 31, 41, 51, 61, 71 (pas 81 ni 91)
  if (u === 1 && t >= 2 && t <= 7) return _TENS[t] + ' et un';
  if (t === 7 && u === 1) return 'soixante et onze';
  return _TENS[t] + (u ? '-' + _UNITS[u] : '');
}

function _below1000(n) {
  if (n < 100) return _below100(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  let head;
  if (h === 1) head = 'cent';
  else head = _UNITS[h] + ' cent' + (r === 0 ? 's' : '');
  return r === 0 ? head : head + ' ' + _below100(r);
}

function _numberToFrenchWords(n) {
  if (!Number.isFinite(n)) return '';
  const int = Math.abs(Math.trunc(n));
  if (int === 0) return 'zéro';

  const billions  = Math.floor(int / 1_000_000_000);
  const millions  = Math.floor((int % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((int % 1_000_000) / 1_000);
  const units     = int % 1_000;

  const parts = [];
  if (billions)  parts.push((billions === 1 ? 'un' : _below1000(billions)) + ' milliard' + (billions > 1 ? 's' : ''));
  if (millions)  parts.push((millions === 1 ? 'un' : _below1000(millions)) + ' million' + (millions > 1 ? 's' : ''));
  if (thousands) parts.push((thousands === 1 ? '' : _below1000(thousands) + ' ') + 'mille');
  if (units)     parts.push(_below1000(units));

  return parts.join(' ').trim().replace(/\s+/g, ' ');
}

// ── Recipes ────────────────────────────────────────────────────
// Chaque recipe reçoit (args, ctx) où :
//   args = tableau des valeurs brutes des champs `from`
//   ctx  = { rule, formData } pour cas avancés (paramètres dans rule)
// Retourne soit une string (à écrire dans le champ cible) soit '' si
// le calcul n'est pas possible (entrées invalides → on n'écrase pas).

const RECIPES = {

  // TTC = HT × (1 + TVA). args = [prix_ht, tva_taux]
  'tva-multiply'(args) {
    const ht   = _num(args[0]);
    const rate = _tvaRate(args[1]);
    if (!Number.isFinite(ht) || !Number.isFinite(rate)) return '';
    return String(_round(ht * (1 + rate)));
  },

  // HT = TTC / (1 + TVA). args = [prix_ttc, tva_taux]
  'tva-divide'(args) {
    const ttc  = _num(args[0]);
    const rate = _tvaRate(args[1]);
    if (!Number.isFinite(ttc) || !Number.isFinite(rate)) return '';
    return String(_round(ttc / (1 + rate)));
  },

  // Montant de TVA = HT × TVA. args = [prix_ht, tva_taux]
  'tva-amount'(args) {
    const ht   = _num(args[0]);
    const rate = _tvaRate(args[1]);
    if (!Number.isFinite(ht) || !Number.isFinite(rate)) return '';
    return String(_round(ht * rate));
  },

  // Pourcentage simple : valeur × factor. args = [base], rule.factor
  percent(args, ctx) {
    const base = _num(args[0]);
    const f    = _num(ctx?.rule?.factor);
    if (!Number.isFinite(base) || !Number.isFinite(f)) return '';
    return String(_round(base * f));
  },

  // Pourcentage défini par un select (ex: depot_pourcentage "5 % (livraison < 1 an)").
  // args = [base, percentText]
  'percent-from-select'(args) {
    const base = _num(args[0]);
    const m    = String(args[1] || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!Number.isFinite(base) || !m) return '';
    const f = parseFloat(m[1].replace(',', '.')) / 100;
    return String(_round(base * f));
  },

  // Nombre → mots français suivis de "euros" (pour montant en lettres).
  // args = [montant_numerique]
  'number-to-french-words-eur'(args) {
    const n = _num(args[0]);
    if (!Number.isFinite(n) || n <= 0) return '';
    const words = _numberToFrenchWords(n);
    return words ? words + ' euros' : '';
  },
};

// ── API ────────────────────────────────────────────────────────

/**
 * Récupère la valeur courante d'un champ du formulaire.
 * Supporte les inputs standards ET les custom selects (data-value).
 */
function _readField(form, fieldId) {
  const el = form.querySelector(`[name="${fieldId}"]`);
  if (!el) return '';
  return (el.value ?? '').trim();
}

/**
 * Écrit une valeur dans un champ et dispatch input/change pour que les
 * autres listeners (preview, AI Assist, etc.) réagissent.
 * Renvoie true si la valeur a réellement changé.
 */
function _writeField(form, fieldId, value) {
  const el = form.querySelector(`[name="${fieldId}"]`);
  if (!el) return false;
  if (el.value === value) return false;
  el.value = value;
  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/**
 * Initialise le moteur sur un formulaire donné, pour un pad donné.
 * Renvoie un cleanup() qui retire les listeners.
 *
 * Anti-loop par BFS avec set `visited` :
 *   - Au déclenchement d'un input utilisateur sur le champ X
 *   - On applique toutes les règles où X est `from`, ce qui peut écrire
 *     dans des champs Y1, Y2…
 *   - On enqueue Y1, Y2 pour cascader leurs propres règles
 *   - Une règle dont le `to` est déjà dans `visited` est skip
 *     → évite les retours arrière (ex: prix_ttc → prix_ht → prix_ttc)
 *   - Un flag _running évite la ré-entrée depuis les dispatchEvent synthétiques
 */
export function initComputedFields(form, pad) {
  const rules = pad?.computed_fields;
  if (!Array.isArray(rules) || rules.length === 0) return () => {};

  // Index : sourceFieldId → liste de règles qui en dépendent
  const sourceIndex = new Map();
  for (const rule of rules) {
    if (!rule?.to || !rule?.recipe || !Array.isArray(rule.from)) continue;
    if (!RECIPES[rule.recipe]) {
      console.warn('[form-computed] recipe inconnue :', rule.recipe);
      continue;
    }
    for (const src of rule.from) {
      if (!sourceIndex.has(src)) sourceIndex.set(src, []);
      sourceIndex.get(src).push(rule);
    }
  }

  let _running = false;

  function applyChain(initialSource) {
    if (_running) return;
    _running = true;
    try {
      const visited = new Set([initialSource]);
      const queue   = [initialSource];

      while (queue.length) {
        const src = queue.shift();
        const rulesToFire = sourceIndex.get(src);
        if (!rulesToFire) continue;

        for (const rule of rulesToFire) {
          // Skip si la cible a déjà été écrite (ou est le déclencheur initial)
          // → empêche les retours arrière (ex: prix_ttc → prix_ht alors qu'on
          //   est parti de prix_ht).
          if (visited.has(rule.to)) continue;

          const args  = rule.from.map(id => _readField(form, id));
          const value = RECIPES[rule.recipe](args, { rule, form });
          if (!value) continue;

          const wrote = _writeField(form, rule.to, value);
          if (wrote) {
            visited.add(rule.to);
            queue.push(rule.to);   // cascade : ses propres règles vont tirer
          }
        }
      }
    } finally {
      _running = false;
    }
  }

  function onInput(e) {
    const el = e.target;
    if (!el?.name) return;
    if (_running) return;   // ré-entrée depuis dispatchEvent synthétique → ignore
    applyChain(el.name);
  }

  form.addEventListener('input',  onInput);
  form.addEventListener('change', onInput);

  return () => {
    form.removeEventListener('input',  onInput);
    form.removeEventListener('change', onInput);
  };
}

// Exposé pour debug console
export const _debug = { RECIPES, _numberToFrenchWords };
