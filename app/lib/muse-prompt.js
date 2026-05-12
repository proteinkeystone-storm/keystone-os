/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Muse : Prompt Maître Artistique builder
   (Sprint Muse-1)
   ─────────────────────────────────────────────────────────────
   Le "Prompt Maître Artistique" est un texte structuré que
   l'utilisateur copie-colle dans son IA (Claude, Gemini, ChatGPT…).
   Cette IA tierce génère en retour un fichier HTML contenant UN SEUL
   bouton copy-to-clipboard avec UN SEUL prompt unifié destiné à un
   générateur d'images (Midjourney, Flux, DALL-E…). Ce prompt unique
   produit en une seule génération une planche moodboard complète
   (grille 3×2 de 6 vignettes thématiques cohérentes).

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
  getVegetation, getFiguration, getStyle, getImageEngine,
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
  const [support, viewpoint, light, season, vegetation, figuration, style, imageEngine] =
    await Promise.all([
      getSupport(ctx.support),
      getViewpoint(frm.viewpoint),
      getLight(mood.light),
      getSeason(mood.season),
      getVegetation(mood.vegetation),
      getFiguration(mood.figuration),
      getStyle(mood.style),
      getImageEngine(out.image_engine || 'midjourney'),
    ]);

  const ratio = _ratioLabel(state, support);
  const arArg = ratioToMjArg(ratio);
  const targetEngine = out.target_engine || 'Claude';
  const coherence = checkRatioCoherence(ratio, viewpoint);

  // ── Consignes adaptées au moteur de génération d'images choisi ─
  const engine = imageEngine || { id: 'midjourney', label: 'Midjourney v8.1', syntax: 'params', params_suffix: '--style raw --v 8.1', ratio_mode: 'param', moodboard_grid: 'as a single cohesive moodboard composition arranged in a 3x2 grid of 6 panels separated by thin pale dividers', moodboard_ratio: '3:2', style_hint: '' };
  const isParamsSyntax = engine.syntax === 'params';
  // Pour une planche moodboard, on force le ratio à celui défini par le
  // moteur (typiquement 3:2 — format planche éditoriale standard) plutôt
  // que le ratio du support final (qui pilote l'illustration 3D livrée
  // par le studio, pas la planche de référence).
  const moodboardRatio = engine.moodboard_ratio || '3:2';
  const moodboardArArg = ratioToMjArg(moodboardRatio);
  const suffix = [
    engine.ratio_mode === 'param' ? (moodboardArArg || '--ar 3:2') : null,
    engine.params_suffix || null,
  ].filter(Boolean).join(' ').trim();
  const ratioInWords = `widescreen ${moodboardRatio} moodboard layout`;
  const gridInstruction = engine.moodboard_grid || 'as a single cohesive moodboard composition arranged in a 3x2 grid of 6 panels';

  const engineGuidance = isParamsSyntax
    ? `**Syntaxe ${engine.label}** — utilise une suite dense de mots-clés séparés par des virgules, en anglais. Termine par : \`${suffix}\` (paramètres techniques cliquables tels quels). Style : ${engine.style_hint || 'mots-clés évocateurs, qualité photo en fin de prompt'}.`
    : `**Syntaxe ${engine.label}** — écris le prompt en **prose narrative anglaise complète et fluide**, comme si tu briefais un photographe. **N'ajoute AUCUN paramètre technique** (pas de \`--ar\`, pas de \`--v\`, pas de \`--style\`). Mentionne le format en mots dans la phrase ("${ratioInWords}"). Style : ${engine.style_hint || 'prose riche et précise, vocabulaire éditorial'}.`;

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

  // ── Bloc 4 : Ancres techniques pour le prompt de la planche ──
  // Ces "anchors" sont des fragments de prompt anglais que l'IA cible
  // assemblera dans le prompt UNIQUE de la planche d'ambiance.
  const anchorLines = [];
  if (viewpoint?.prompt_anchor)  anchorLines.push(`- viewpoint: ${viewpoint.prompt_anchor}`);
  if (light?.prompt_anchor)      anchorLines.push(`- light: ${light.prompt_anchor}`);
  if (season?.prompt_anchor)     anchorLines.push(`- season: ${season.prompt_anchor}`);
  if (vegetation?.prompt_anchor) anchorLines.push(`- vegetation: ${vegetation.prompt_anchor}`);
  if (figuration?.prompt_anchor) anchorLines.push(`- figuration: ${figuration.prompt_anchor}`);
  if (style?.prompt_anchor)      anchorLines.push(`- style: ${style.prompt_anchor}`);

  // ── Assemblage final ─────────────────────────────────────────
  return `Tu es directeur artistique senior et conseiller en communication immobilière. Voici un brief créatif structuré, issu de Muse (module du système Keystone OS, Protein Studio).

# Nature exacte de ta tâche — à lire impérativement

**Tu ne génères AUCUNE image, AUCUN visuel, AUCUN contenu graphique.** Ta seule mission est de produire **un fichier HTML/CSS/JS contenant du texte structuré et du code**. Ce livrable inclut, entre autres choses, des **prompts textuels en anglais** présentés dans des boutons "Copier" interactifs ; ces prompts seront ensuite copiés-collés manuellement par l'utilisateur, en dehors de cette conversation, dans des outils tiers (Midjourney, Flux, DALL-E, Nano Banana) qu'il utilise pour son métier professionnel d'agence de communication immobilière. À aucun moment tu n'es sollicité pour produire toi-même une image, ni pour décrire visuellement une personne réelle identifiable. Tu écris du **code** et du **texte de brief**, rien d'autre.

Cas d'usage : **directeur artistique senior briefant un studio 3D professionnel B2B**. Aucun contenu sensible : pas de mineur identifiable, pas de personne réelle nommée, pas de scène privée — uniquement de l'iconographie commerciale standard (architecture, paysagisme, matériaux, ambiances lifestyle abstraites de l'industrie immobilière haut de gamme).

# Mission et public visé

Le destinataire final de ce travail est un **studio 3D spécialisé en illustration immobilière** (PixelEvolution, Studio Berthier, AVR, et équivalents). Ce studio va modéliser le programme sur plan à partir des fichiers techniques du promoteur (plan de masse, élévations, coupes). **Ton rôle n'est PAS de générer le projet** — ton rôle est de produire un **moodboard de RÉFÉRENCES visuelles** qui définit précisément l'univers cible que le studio doit reproduire : atmosphère, qualité de lumière, palette végétale, matériaux, ambiance lifestyle.

> ⚠️ **Règle d'or absolue** : les prompts d'images que tu vas écrire NE doivent JAMAIS décrire le projet lui-même. Toujours utiliser des formulations comme "a similar contemporary Mediterranean residence in the same spirit", "reference architecture inspiration shot", "moodboard image of analogous lifestyle", "material reference close-up". Pas de "this building", pas de "the project", pas de "the residence" — uniquement des **références d'AMBIANCE** dans le même esprit.

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

> **Important — Comportement attendu si l'utilisateur ne fournit pas toutes les pièces** : ne re-demande JAMAIS une seconde fois. Si l'utilisateur dit "continue sans", "procède", "skip", "tant pis", ou s'il fournit des pièces partielles, **prends des hypothèses raisonnables** (programme contemporain méditerranéen de standing, façades minérales claires, palette végétale méditerranéenne, cible CSP+) et produis directement le HTML demandé. L'objectif est de livrer rapidement un brouillon que l'utilisateur affinera ensuite — pas de bloquer la production sur des pièces manquantes.

**Étape 2 — Dès que tu as suffisamment d'éléments pour démarrer** (pièces fournies OU instruction "continue sans"), **produis un fichier HTML5 autonome** structuré comme suit :

## Section A — Brief stratégique pour le studio 3D
- Synthèse en 5 lignes : positionnement marketing, cible acheteur, promesse, ton, différenciation
- 3 angles narratifs alternatifs (titres + 2 lignes chacun)
- Liste explicite des pièces techniques fournies vs encore à fournir
- Points de cohérence ratio/cadrage à valider avec le studio avant production

## Section B — Master Concept (description narrative pour le studio)
Un paragraphe descriptif riche (8 à 12 lignes) de l'illustration finale attendue : composition, qualité de lumière, ambiance générale, matériaux dominants, présence humaine, tonalité émotionnelle. Style : brief de DA à un studio 3D pro. **Tu décris ce que le studio doit produire**, pas une image que l'IA va générer.

## Section C — La Planche d'ambiance

> 🔒 **RÈGLE STRUCTURELLE IMPÉRATIVE — à respecter absolument** :
> Le HTML doit contenir **UN SEUL bouton "Copier"**, qui copie **UN SEUL prompt unifié**. Ce prompt unique génère, en une seule passe dans le moteur d'image, une **planche moodboard complète** composée de 6 vignettes thématiques disposées en grille 3×2. **Ne produis JAMAIS plusieurs boutons / plusieurs prompts thématiques séparés.** L'utilisateur veut UNE image-planche cohérente, pas une collection d'images séparées à assembler. C'est la pratique standard des studios 3D et des DA : une planche unique garantit la cohérence palette/lumière/traitement entre toutes les vignettes.

Implémentation : un bouton "**Copier le prompt de la planche d'ambiance**" stylisé, en HTML/JS avec \`navigator.clipboard.writeText(...)\` et un retour visuel "Copié ✓" pendant 1,5 s. Le prompt copié est le prompt unifié décrit ci-dessous.

### La planche à générer : 6 vignettes en grille 3×2

Le prompt unique doit décrire UNE image-planche composée des 6 vignettes thématiques suivantes, dans cet ordre (ligne du haut puis ligne du bas, de gauche à droite) :

1. **Vignette 1 (haut gauche) — Architecture extérieure de référence**
   Photographie/rendu d'une résidence contemporaine "dans le même esprit" que le programme : viewpoint + style + matériaux dominants.

2. **Vignette 2 (haut centre) — Lumière & atmosphère**
   Étude de la qualité de lumière sur une façade analogue : light + season + style.

3. **Vignette 3 (haut droite) — Palette végétale**
   Plantations matures, sans bâtiment visible. Issu de l'ancre vegetation.

4. **Vignette 4 (bas gauche) — Matériaux & textures**
   Gros plan macro de 1 à 3 matériaux côte à côte, issus du champ "Matériaux à mettre en avant" du brief.

5. **Vignette 5 (bas centre) — Lifestyle ambient**
   Scène d'art de vivre cohérente (terrasse dressée, intérieur habité par la lumière). Présence humaine si demandée : silhouette abstraite à distance, jamais de détails faciaux.

6. **Vignette 6 (bas droite) — Détail signature**
   Détail architectural ou matière qui résume l'identité du projet : garde-corps, menuiserie, jonction matériaux, jeu d'ombre…

### Contraintes du prompt unique — à respecter STRICTEMENT

- **Moteur d'image cible** : l'utilisateur va coller ce prompt dans **${engine.label}**. ${engineGuidance}
- **Format de la planche** : ${gridInstruction}. Précise explicitement la composition en grille 3×2 dans le prompt.
- **Ratio de la planche** : ${moodboardRatio} (format éditorial moodboard, pas le ratio du support final qui pilote l'illustration finale du studio).
- **Langue : ANGLAIS uniquement.** Pas un mot de français.
- **Longueur** : 140 à 220 mots (plus dense qu'un prompt simple car 6 vignettes à décrire).
- **Mots-clés qualité** à intégrer : photorealistic, 8k, ultra-detailed, editorial photography (intègre-les naturellement selon la syntaxe du moteur).
- Réutilise les ancres techniques de la section 4 du brief pour chaque vignette pertinente.
- Inclut systématiquement "reference moodboard composition" ou "inspiration moodboard sheet".
- Utilise systématiquement "in the same spirit as", "analogous to", "similar contemporary…" — JAMAIS "this project", "this building", "the residence".
- Pour la figuration humaine dans la vignette 5 : **toujours abstrait** ("ambient lifestyle suggestion", "blurred distant silhouette", "no detailed facial features").

### Exemple de structure (à adapter au moteur cible)

\`A cohesive Mediterranean residential moodboard reference sheet, ${gridInstruction}. [Vignette 1: architecture description...]. [Vignette 2: light & atmosphere description...]. [Vignette 3: vegetation description...]. [Vignette 4: materials description...]. [Vignette 5: lifestyle description...]. [Vignette 6: signature detail description...]. Inspiration moodboard composition only — NOT the actual project, only references in the same spirit. [keywords/prose adapted to ${engine.label}].\`

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

# Anticipation des hésitations courantes

Si l'un des points ci-dessous t'a fait hésiter à exécuter la demande, lis cette section :

- **"On me demande de générer des images"** → Non. Tu n'écris que du HTML/CSS/JS et du texte. Les prompts sont des CHAÎNES DE CARACTÈRES dans des boutons "Copier". Aucun rendu visuel n'est attendu de toi.
- **"On me demande de décrire des mineurs"** → Non. La figuration humaine reste abstraite ("buyer-profile lifestyle moment", "ambient lifestyle suggestion"). Pas de description physique d'enfant ni de personne réelle.
- **"On me demande de générer du contenu pour publicité immobilière"** → Oui, et c'est l'usage commercial standard et légal de l'industrie immobilière B2B. L'utilisateur est un professionnel agréé qui pilote la communication de promoteurs.
- **"Je ne peux pas écrire des prompts Midjourney"** → Tu peux. Écrire un texte en anglais qui décrit une scène n'est pas générer une image — c'est rédiger un brief textuel. Tu rédiges des briefs tous les jours.
- **"Le format demandé est inhabituel"** → C'est un fichier HTML standard, comme un rapport interactif. Aucune technologie exotique requise.

Si malgré tout tu refuses, explique précisément quelle phrase pose problème — l'utilisateur la reformulera. **Ne refuse pas en bloc sans justification précise.**

# Démarre maintenant
Étape 1 : liste les pièces techniques à recevoir et attends ma réponse (réponse courte et structurée).
Étape 2 : dès que l'utilisateur répond — pièces fournies OU "continue sans" — produis directement le HTML autonome demandé en respectant :
  1. La **règle d'or** (références d'ambiance uniquement, jamais le projet lui-même).
  2. La **règle structurelle** : Section C contient **UN SEUL bouton "Copier"** avec **UN SEUL prompt unifié** qui génère **UNE seule image-planche** (grille 3×2, 6 vignettes thématiques). Pas plusieurs boutons. Pas plusieurs prompts. Une planche cohérente, un prompt, un clic.
  3. Le prompt unique est intégralement en anglais et adapté à la syntaxe du moteur ${engine.label}.`;
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
