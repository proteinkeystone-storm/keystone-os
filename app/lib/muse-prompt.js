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
  return `Tu es directeur artistique senior et conseiller en communication immobilière. Voici un brief créatif structuré, issu de Muse (module du système Keystone OS, Protein Studio).

# Mission et public visé

Le destinataire final de ce travail est un **studio 3D spécialisé en illustration immobilière** (PixelEvolution, Studio Berthier, AVR, et équivalents). Ce studio va modéliser le programme sur plan à partir des fichiers techniques du promoteur (plan de masse, élévations, coupes). **Ton rôle n'est PAS de générer le projet** — ton rôle est de produire un **moodboard de RÉFÉRENCES visuelles** qui définit précisément l'univers cible que le studio doit reproduire : atmosphère, qualité de lumière, palette végétale, matériaux, ambiance lifestyle.

> ⚠️ **Règle d'or absolue** : les prompts d'images que tu vas générer NE doivent JAMAIS décrire le projet lui-même. Toujours utiliser des formulations comme "a similar contemporary Mediterranean residence in the same spirit", "reference architecture inspiration shot", "moodboard image of analogous lifestyle", "material reference close-up". Pas de "this building", pas de "the project", pas de "the residence" — uniquement des **références d'AMBIANCE** dans le même esprit.

# Brief créatif client

## 1. Contraintes techniques (importées depuis le support)
${techLines || '(non renseignées)'}

## 2. Cadrage souhaité (angle de l'illustration finale)
${framingLines || '(non renseigné)'}

## 3. Atmosphère cible
${moodLines || '(non renseignée)'}

## 4. Ancres techniques pour les prompts images
${anchorLines.length ? anchorLines.join('\n') : '(non renseignées — laisse libre)'}

${coherence ? `> ⚠️ **Note de cohérence** : ${coherence}\n` : ''}
---

# Ton livrable

**Étape 1 — Avant de produire le HTML**, DEMANDE au client de te transmettre les pièces suivantes (réponds d'abord par un court message listant ce que tu attends, puis attends sa réponse) :
- **Plan de masse** du programme (PDF ou image)
- **Élévations / façades** (si disponibles)
- **Coupes** ou perspectives techniques
- **Fiche programme** (typologies, surfaces, particularités)
- **Logo et charte graphique** (couleurs, polices)
- **Références déjà validées** par le client ou le studio (autres projets que le client aime)
- **Identité du studio 3D** prévu (utile pour adapter le ton du brief)

**Étape 2 — Une fois ces pièces reçues** (ou si l'utilisateur te dit de continuer sans), **produis un fichier HTML5 autonome** structuré comme suit :

## Section A — Brief stratégique pour le studio 3D
- Synthèse en 5 lignes : positionnement marketing, cible acheteur, promesse, ton, différenciation
- 3 angles narratifs alternatifs (titres + 2 lignes chacun)
- Liste explicite des pièces techniques fournies vs encore à fournir
- Points de cohérence ratio/cadrage à valider avec le studio avant production

## Section B — Master Concept (description narrative pour le studio)
Un paragraphe descriptif riche (8 à 12 lignes) de l'illustration finale attendue : composition, qualité de lumière, ambiance générale, matériaux dominants, présence humaine, tonalité émotionnelle. Style : brief de DA à un studio 3D pro. **Tu décris ce que le studio doit produire**, pas une image que l'IA va générer.

## Section C — Le Labo Moodboard de références (4 CTA copy-to-clipboard)
Quatre boutons "**Copier**" stylisés, chacun donnant accès à un prompt optimisé pour générateur d'image IA (Midjourney, Flux, DALL-E, Nano Banana, Gemini). Implémente chaque bouton en HTML/JS avec \`navigator.clipboard.writeText(...)\` et un retour visuel "Copié ✓" pendant 1,5 s.

Chaque prompt sert à générer une **image de référence** que le client glissera dans son partage avec le studio 3D. **Aucun de ces prompts ne doit décrire le projet réel — uniquement des références d'ambiance dans le même esprit.**

Les 4 CTA :

1. **CTA Référence Architecture** — ambiance architecturale similaire (pas le projet)
   Exemple de formulation : *"editorial architectural photography of a contemporary Mediterranean luxury residence in the same spirit as the project, [viewpoint], [light], [style], reference moodboard image only, NOT the actual project"*

2. **CTA Référence Lifestyle** — vie quotidienne de la cible humaine
   Exemple : *"lifestyle reference photography of [figuration] in a similar contemporary residential setting, candid moment, aspirational ambient image, moodboard inspiration"*

3. **CTA Référence Paysage & Végétation** — palette végétale pour le paysagiste 3D
   Exemple : *"landscape design reference, [vegetation], close-up of mature planting, garden moodboard image for a landscape architect, no buildings, pure vegetation study"*

4. **CTA Référence Textures & Matériaux** — gros plans pour le shader artist 3D
   Exemple : *"material reference close-up macro photography, [materials], natural light grazing texture, sample board for a 3D shader artist, no architecture, pure material study"*

**Contraintes techniques de chaque prompt secondaire** :
- Entre 60 et 110 mots
- Anglais (langue native des générateurs d'images)
- Termine TOUJOURS par : \`${arArg || '--ar (à préciser selon support)'} --style raw --v 6\`
- Mots-clés qualité : \`photorealistic, 8k, ultra-detailed, professional photography\`
- Réutilise les ancres techniques de la section 4 du brief
- Inclut systématiquement la mention "reference moodboard image" ou équivalent
- Inclut "in the same spirit as" / "analogous to" / "similar contemporary…" — JAMAIS "this project"

## Section D — Pièces techniques à transmettre au studio 3D
Termine la page HTML par un bloc clair "Pièces à transmettre au studio 3D" qui liste tous les fichiers techniques (plan masse, élévations, coupes, fiche programme, charte, références validées) que le promoteur doit packager pour le studio. Ce bloc sert de checklist pour le client.

---

# Contraintes de style HTML

- **Charte** : Apple Premium / éditorial. Fond sombre \`#131826\`, surface \`#1c2234\`, accent indigo \`#6366f1\` (utilisé pour les CTA et accents).
- **Typographie** : font-stack native (\`-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif\`), \`letter-spacing: -0.02em\` sur les titres, \`font-weight: 900\` sur le titre principal.
- **Cards** : border-radius 14px, padding généreux (24–32 px), bordure subtile \`rgba(255,255,255,0.08)\`.
- **CTA Moodboard** : boutons bien visibles, hover discret, icône de copie à gauche, état "Copié ✓" en vert \`#16a34a\`.
- **Aucune image externe**, aucun CDN, aucune dépendance — tout inline (CSS dans \`<style>\`, JS dans \`<script>\`).
- **Responsive** : fonctionne en plein écran desktop ET en mobile (un seul scroll vertical).
- **Pas d'emoji** dans l'UI HTML, sauf le ✓ dans le bouton "Copié".

# Moteur cible
Ce brief est optimisé pour **${targetEngine}**. Tu es ${targetEngine}.

# Démarre maintenant
Étape 1 : liste les pièces techniques à recevoir et attends ma réponse.
Étape 2 : produis le HTML autonome demandé en respectant la règle d'or (références uniquement, jamais le projet lui-même).`;
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
