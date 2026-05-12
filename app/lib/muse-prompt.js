/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Muse : Prompt Maître Artistique builder
   (Sprint Muse-1)
   ─────────────────────────────────────────────────────────────
   Le "Prompt Maître Artistique" est un texte structuré que
   l'utilisateur copie-colle dans son IA (Claude, Gemini, ChatGPT…).
   Cette IA tierce génère en retour un dashboard HTML interactif
   contenant 4 CTA copy-to-clipboard pour des prompts secondaires
   destinés aux générateurs d'images (Midjourney, Flux, DALL-E…).

   Muse n'appelle PAS de LLM lui-même : il assemble du texte
   à partir des choix de l'utilisateur. La génération visuelle
   est entièrement déléguée à l'IA cible.

   Sources des éléments :
     - state.context  : support, ratio, secteur, projet, localisation
     - state.framing  : point de vue, sujet, intention focale
     - state.mood     : lumière, saison, végétation, figuration, style
     - state.output   : moteur cible (pour mention dans l'instruction système)
   ═══════════════════════════════════════════════════════════════ */

import {
  getSupport, getViewpoint, getLight, getSeason,
  getVegetation, getFiguration, getStyle,
  checkRatioCoherence, ratioToMjArg,
} from './muse-catalog.js';

// ── Helpers ───────────────────────────────────────────────────
function _line(label, value) {
  if (value == null || value === '') return null;
  return `- **${label}** : ${value}`;
}

function _ratioLabel(state, support) {
  const r = state.context?.ratio || support?.default_ratio || '';
  return r || 'à préciser';
}

function _dimensions(state) {
  const w = state.context?.width_mm;
  const h = state.context?.height_mm;
  if (!w && !h) return null;
  if (w && h) return `${w} × ${h} mm`;
  return `${w || '?'} × ${h || '?'} mm`;
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

/**
 * Construit le Prompt Maître Artistique à coller dans une IA tierce.
 * Hydrate les ids du state vers leurs définitions complètes depuis
 * le catalogue d'options, puis assemble un texte markdown structuré.
 *
 * @param {object} state  l'état Muse complet (_state)
 * @returns {Promise<string>}  prompt complet à coller dans l'IA cible
 */
export async function buildPromptMaitre(state) {
  const ctx  = state.context  || {};
  const frm  = state.framing  || {};
  const mood = state.mood     || {};
  const out  = state.output   || {};

  // Hydrate tous les ids en parallèle vers leurs définitions complètes
  const [support, viewpoint, light, season, vegetation, figuration, style] =
    await Promise.all([
      getSupport(ctx.support),
      getViewpoint(frm.viewpoint),
      getLight(mood.light),
      getSeason(mood.season),
      getVegetation(mood.vegetation),
      getFiguration(mood.figuration),
      getStyle(mood.style),
    ]);

  const ratio = _ratioLabel(state, support);
  const arArg = ratioToMjArg(ratio);
  const targetEngine = out.target_engine || 'Claude';
  const coherence = checkRatioCoherence(ratio, viewpoint);

  // ── Bloc 1 : Contraintes techniques (importées du support) ──
  const techLines = [
    _line('Support', support?.label || ctx.support_label || '(non spécifié)'),
    _line('Ratio cible', ratio),
    _line('Dimensions', _dimensions(state)),
    _line('Contexte de vue', support?.context),
    _line('Secteur', ctx.sector),
    _line('Projet', ctx.project_name),
    _line('Localisation', ctx.location),
  ].filter(Boolean).join('\n');

  // ── Bloc 2 : Cadrage ─────────────────────────────────────────
  const framingLines = [
    _line('Point de vue', viewpoint ? `${viewpoint.label} — ${viewpoint.narrative}` : null),
    _line('Sujet principal', frm.subject),
    _line('Intention focale', frm.focal_intent),
  ].filter(Boolean).join('\n');

  // ── Bloc 3 : Atmosphère ──────────────────────────────────────
  const moodLines = [
    _line('Lumière', light ? `${light.label} — ${light.short}` : null),
    _line('Saison', season?.label),
    _line('Végétation', vegetation?.label),
    _line('Figuration humaine', figuration?.label),
    _line('Direction artistique', style?.label),
    _line('Matériaux à mettre en avant', mood.materials_focus),
  ].filter(Boolean).join('\n');

  // ── Bloc 4 : Ancres techniques pour les prompts secondaires ─
  // Ces "anchors" sont des fragments de prompt anglais prêts à être
  // assemblés par l'IA cible dans les 4 CTA Moodboard.
  const anchorLines = [];
  if (viewpoint?.prompt_anchor)  anchorLines.push(`- viewpoint: ${viewpoint.prompt_anchor}`);
  if (light?.prompt_anchor)      anchorLines.push(`- light: ${light.prompt_anchor}`);
  if (season?.prompt_anchor)     anchorLines.push(`- season: ${season.prompt_anchor}`);
  if (vegetation?.prompt_anchor) anchorLines.push(`- vegetation: ${vegetation.prompt_anchor}`);
  if (figuration?.prompt_anchor) anchorLines.push(`- figuration: ${figuration.prompt_anchor}`);
  if (style?.prompt_anchor)      anchorLines.push(`- style: ${style.prompt_anchor}`);

  // ── Assemblage final ─────────────────────────────────────────
  return `Tu es directeur artistique senior et conseiller en communication immobilière. Voici un brief créatif structuré, issu de Muse (module du système Keystone OS, Protein Studio). Ta mission : produire un livrable HTML interactif AUTONOME, à enregistrer comme fichier .html.

# Brief créatif client

## 1. Contraintes techniques (importées depuis le support)
${techLines || '(non renseignées)'}

## 2. Cadrage souhaité
${framingLines || '(non renseigné)'}

## 3. Atmosphère cible
${moodLines || '(non renseignée)'}

## 4. Ancres techniques pour les prompts images
${anchorLines.length ? anchorLines.join('\n') : '(non renseignées — laisse libre)'}

${coherence ? `> ⚠️ **Note de cohérence** : ${coherence}\n` : ''}
---

# Ton livrable

**Avant de produire le HTML, DEMANDE au client de te transmettre les pièces jointes suivantes** (réponds d'abord par un court message listant ce que tu attends, puis attends sa réponse) :
- Photo de la parcelle / plan de masse
- Illustration 3D brute du programme (si déjà disponible)
- Logo et charte graphique (couleurs, polices)
- Toute photo d'ambiance déjà validée par le client

Une fois ces pièces reçues (ou si l'utilisateur te dit de continuer sans), **produis un fichier HTML5 autonome** qui contient les sections suivantes, dans cet ordre :

## Section A — Brief stratégique
- Synthèse marketing en 5 lignes (positionnement, cible, promesse, ton, différenciation)
- 3 angles narratifs alternatifs (titres + 2 lignes chacun)
- Liste explicite des assets à fournir vs déjà connus
- Points de cohérence ratio/cadrage à vérifier avant production

## Section B — Master Concept (description narrative)
Un paragraphe descriptif riche du rendu cible (lumière, composition, atmosphère, matériaux, tonalité émotionnelle). Style : narratif comme un brief de photographe / DA. 8 à 12 lignes.

## Section C — Le Labo Moodboard (4 CTA copy-to-clipboard)
Quatre boutons "**Copier**" stylisés, chacun donnant accès à un prompt optimisé pour générateur d'image IA (Midjourney, Flux, DALL-E, Nano Banana, Gemini, etc.). Implémente chaque bouton en HTML/JS avec \`navigator.clipboard.writeText(...)\` et un retour visuel "Copié ✓" pendant 1,5 s.

Les 4 CTA :

1. **CTA Architecture** — focus bâtiment, composition, matériaux, vues
2. **CTA Lifestyle** — focus cible humaine, déco, vie quotidienne
3. **CTA Palette végétale** — focus paysagisme, espèces, ambiance jardin
4. **CTA Textures & matériaux** — focus matières (pierre, bois, alu, béton), gros plans

**Contraintes techniques pour chaque prompt secondaire** :
- Entre 60 et 110 mots
- Anglais (langue native des générateurs d'images)
- Termine TOUJOURS par : \`${arArg || '--ar (à préciser selon support)'} --style raw --v 6\`
- Mots-clés qualité : \`photorealistic, 8k, ultra-detailed, professional photography\`
- Réutilise les ancres techniques de la section 4 du brief (viewpoint, light, season, vegetation, figuration, style)

## Section D — Pièces à glisser dans cette conversation
Termine la page HTML par un bloc clair "Pièces à glisser dans cette conversation" qui rappelle visuellement les assets attendus.

---

# Contraintes de style HTML

- **Charte** : Apple Premium / éditorial. Fond sombre \`#131826\`, surface \`#1c2234\`, accent indigo \`#6366f1\` (utilisé pour les CTA et accents).
- **Typographie** : font-stack native (\`-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif\`), \`letter-spacing: -0.02em\` sur les titres, \`font-weight: 900\` sur le titre principal.
- **Cards** : border-radius 14px, padding généreux (24–32 px), bordure subtile \`rgba(255,255,255,0.08)\`.
- **CTA Moodboard** : boutons bien visibles, hover discret, icône de copie à gauche, état "Copié ✓" en vert \`#16a34a\`.
- **Aucune image externe**, aucun CDN, aucune dépendance — tout inline (CSS dans \`<style>\`, JS dans \`<script>\`).
- **Responsive** : fonctionne en plein écran desktop ET en mobile (un seul scroll vertical).
- **Pas d'emoji** dans l'UI HTML, sauf le ✓ dans le bouton "Copié".

# Moteur cible recommandé
Ce brief est optimisé pour **${targetEngine}**. Tu es ${targetEngine}.

# Démarre maintenant
Étape 1 : liste les pièces à recevoir et attends ma réponse.
Étape 2 : produis le HTML autonome demandé.`;
}

/**
 * Vérifie si le state contient le minimum requis pour générer le
 * Prompt Maître. Retourne null si OK, sinon un message d'erreur.
 */
export function validateForGeneration(state) {
  const ctx  = state.context  || {};
  const frm  = state.framing  || {};
  const mood = state.mood     || {};

  if (!ctx.support) {
    return 'Sélectionnez un support à l\'étape 1 (Le contexte).';
  }
  if (!frm.viewpoint) {
    return 'Choisissez un point de vue à l\'étape 2 (Le cadrage).';
  }
  // Au moins une option d'atmosphère doit être renseignée
  const moodFilled = ['light', 'season', 'vegetation', 'figuration', 'style']
    .some(k => mood[k]);
  if (!moodFilled) {
    return 'Renseignez au moins un paramètre d\'atmosphère à l\'étape 3.';
  }
  return null;
}
