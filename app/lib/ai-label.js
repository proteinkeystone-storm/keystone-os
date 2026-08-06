/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Label « AI » officiel de la Commission européenne
   (étiquetage des contenus IA, art. 50 du règlement UE 2024/1689)

   Icône publiée par la Commission, LIBREMENT utilisable par tous,
   sans attribution :
   https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content

   ── Pourquoi ce module plutôt qu'une image ─────────────────────
   Le fichier officiel porte ses couleurs dans un <style> interne
   (.cls-1/.cls-2). Inliné tel quel dans une page, ce bloc FUIT dans
   tout le document et repeint n'importe quel élément qui aurait les
   mêmes noms de classe. Les tracés sont donc recopiés à l'identique
   mais colorés par attributs de présentation.

   ── Deux variantes, et le choix n'est pas cosmétique ───────────
   Sur un fond sombre, la variante noire disparaît : son disque est
   noir à 50 % d'opacité, il ne reste que les deux lettres, et le
   label n'est plus reconnaissable comme le label officiel. Sur un
   fond clair, c'est l'inverse. Les deux sont publiées par la
   Commission — prendre celle qui contraste avec le FOND, pas celle
   qui plaît.

   ⚠ La page publique `agent.html` garde sa propre copie inline : ce
   n'est pas un oubli. C'est une page autonome servie hors du
   dashboard, à qui l'on évite une requête de module supplémentaire.
   Toute correction de tracé ici doit y être reportée à la main.
   ═══════════════════════════════════════════════════════════════ */

const DISQUE = 'M272.03,100.72c100.92,0,182.74,81.82,182.74,182.75s-81.82,182.74-182.74,182.74-182.75-81.82-182.75-182.74,81.82-182.75,182.75-182.75';
const LETTRE_A = 'M170.79,353.74c-1.08,0-2.05-.43-2.92-1.31-.88-.87-1.31-1.84-1.31-2.92,0-.67.07-1.27.2-1.81l47.34-129.32c.4-1.48,1.24-2.79,2.52-3.93,1.27-1.14,3.05-1.71,5.34-1.71h29.81c2.28,0,4.06.57,5.34,1.71,1.27,1.14,2.11,2.45,2.52,3.93l47.14,129.32c.27.54.4,1.14.4,1.81,0,1.08-.44,2.05-1.31,2.92s-1.91,1.31-3.12,1.31h-24.78c-2.01,0-3.52-.5-4.53-1.51-1.01-1.01-1.65-1.91-1.91-2.72l-7.86-20.55h-53.78l-7.65,20.55c-.27.81-.88,1.71-1.81,2.72-.94,1.01-2.55,1.51-4.83,1.51h-24.78ZM218.13,299.96h37.47l-18.93-53.18-18.53,53.18Z';
const LETTRE_I = 'M328.11,353.74c-1.48,0-2.69-.47-3.63-1.41-.94-.94-1.41-2.15-1.41-3.63v-130.93c0-1.48.47-2.68,1.41-3.63s2.15-1.41,3.63-1.41h26.99c1.48,0,2.68.47,3.63,1.41.94.94,1.41,2.15,1.41,3.63v130.93c0,1.48-.47,2.69-1.41,3.63-.94.94-2.15,1.41-3.63,1.41h-26.99Z';

/**
 * Rend le label officiel en SVG inline.
 * @param {number} size    côté en pixels (le label est carré)
 * @param {'dark'|'light'} fond  couleur du FOND sur lequel il se pose —
 *        'dark' prend la variante blanche, 'light' la variante noire.
 */
export function aiLabelSVG(size = 22, fond = 'dark') {
  const clair = (fond === 'dark');
  const disque = clair ? '#fff' : '#000';
  const lettres = clair ? '#1d1d1b' : '#fff';
  return `<svg viewBox="0 0 566.93 566.93" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<path fill="${disque}" fill-rule="evenodd" opacity=".5" d="${DISQUE}"/>`
    + `<path fill="${lettres}" d="${LETTRE_A}"/><path fill="${lettres}" d="${LETTRE_I}"/></svg>`;
}
