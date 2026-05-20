/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Kodex : Code Maître builder (Sprint Kodex-4.1)
   ─────────────────────────────────────────────────────────────
   Le "Code Maître" est le prompt structuré envoyé au moteur AI
   choisi par l'utilisateur. Il assemble :
     - Les contraintes techniques verrouillées (standard sélectionné)
     - Les données métier saisies (sector + fields)
     - La charte graphique connue
     - Les mentions légales obligatoires
     - Les contraintes d'échelle calculées

   Le moteur AI produit :
     - Un brief technique structuré pour le maquettiste
     - 5 punchlines marketing inspirées par l'argumentaire
     - Des alertes en cas d'incohérence détectée
   ═══════════════════════════════════════════════════════════════ */

import { formatDimensions, formatBleed, computeLegalMentions, getVendor } from './kodex-catalog.js';
import { computeScale } from './kodex-scale.js';

// ── Helpers de formatage pour le prompt ───────────────────────
function _fieldValue(v) {
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  return String(v);
}

function _renderVendorBlock(vendor) {
  if (!vendor || vendor.level === 3) return '';
  const lines = [];
  lines.push('');
  lines.push(`### Préparation spécifique chez ${vendor.label} :`);
  if (vendor.url)
    lines.push(`- Fiche officielle : ${vendor.url}`);
  if (Array.isArray(vendor.system_layers) && vendor.system_layers.length)
    lines.push(`- Calques système attendus : ${vendor.system_layers.join(', ')}`);
  if (vendor.rich_black)
    lines.push(`- Noir riche recommandé : ${vendor.rich_black}`);
  if (vendor.max_file_size_mb)
    lines.push(`- Taille fichier finale : < ${vendor.max_file_size_mb} Mo`);
  if (Array.isArray(vendor.preparation_steps) && vendor.preparation_steps.length) {
    lines.push('- Étapes de préparation obligatoires :');
    vendor.preparation_steps.forEach(p => lines.push(`  * ${p}`));
  }
  return lines.join('\n');
}

function _renderTechBlock(std, destState, vendor) {
  if (!std) return '';
  const scale = computeScale(std);
  // Résolution toujours 300 DPI pour le print (modèle Kodex) ; échelle et
  // format de travail détaillés dans le bloc « Contraintes d'échelle ».
  const lines = [
    std.vendor ? `- **Prestataire visé** : ${std.vendor}` : null,
    `- **Type de support** : ${std.type_support || std.product_name || '(non précisé)'}`,
    `- **Format fini** : ${formatDimensions(std)}`,
    formatBleed(std) ? `- **Fond perdu** : ${formatBleed(std)}` : null,
    std.safe_margin_mm ? `- **Marge de sécurité** : ${std.safe_margin_mm} mm` : null,
    `- **Résolution** : ${scale && scale.output_dpi ? scale.output_dpi : (std.dpi || 300)} DPI`,
    std.color_profile ? `- **Colorimétrie** : ${std.color_profile}` : null,
    std.export_format ? `- **Export attendu** : ${std.export_format}` : null,
    std.material ? `- **Matière / finition** : ${std.material}` : null,
    destState?.vendor_url ? `- **Fiche technique officielle** : ${destState.vendor_url}` : null,
    destState?.specs_pdf ? `- **PDF de specs du prestataire joint au brief** : ${destState.specs_pdf.url}` : null,
  ].filter(Boolean);

  // Bloc échelle (killer feature)
  if (scale && !scale.digital) {
    lines.push('');
    lines.push(`### Contraintes d'échelle :`);
    lines.push(`- Résolution de sortie : ${scale.output_dpi} DPI (fixe — ne jamais dégrader)`);
    lines.push(`- Échelle de travail : ${scale.factor_label}`);
    if (scale.work_format) {
      lines.push(`- Travail sur maquette : ${scale.work_format.width_mm} × ${scale.work_format.height_mm} mm`);
      lines.push(`- Fichier à produire : ${scale.work_format.width_px} × ${scale.work_format.height_px} px à ${scale.output_dpi} DPI`);
    }
    lines.push(`- Distance de vue : ${scale.viewing_distance} (${scale.viewing_context.toLowerCase()})`);
    lines.push(`- Hauteur minimum titre lisible : ${scale.min_text_mm} mm`);
    if (scale.min_logo_px) {
      lines.push(`- Logo bitmap minimum : ${scale.min_logo_px} px de large`);
    }
    if (scale.warning) {
      lines.push(`- ⚠️ ALERTE : ${scale.warning}`);
    }
  }

  if (std.notes) {
    lines.push('');
    lines.push(`### Note du prestataire :`);
    lines.push(std.notes);
  }

  // Ajoute la section "Préparation spécifique chez X" si vendor connu (lvl 1-2)
  const vendorBlock = _renderVendorBlock(vendor);
  if (vendorBlock) lines.push(vendorBlock);

  return lines.join('\n');
}

function _renderContentBlock(sector, fields) {
  if (!sector) return '';
  const lines = [`### Profil métier : ${sector.label}`];
  for (const field of sector.fields) {
    const val = _fieldValue(fields?.[field.name]);
    if (val) {
      lines.push(`- **${field.label}** : ${val}`);
    }
  }
  return lines.join('\n');
}

function _renderAssetsBlock(assets) {
  const lines = ['### Assets disponibles :'];
  const owned = [];
  if (assets.logo_owned)   owned.push('Logo principal');
  if (assets.charte_owned) owned.push('Charte graphique');
  if (assets.fonts_owned)  owned.push('Polices');
  if (owned.length) lines.push(`- Déjà transmis au graphiste : ${owned.join(', ')}`);

  const c = assets.charte || {};
  const charteParts = [];
  if (c.primary_hex)   charteParts.push(`couleur principale ${c.primary_hex}`);
  if (c.secondary_hex) charteParts.push(`couleur secondaire ${c.secondary_hex}`);
  if (c.font_title)    charteParts.push(`police titre "${c.font_title}"`);
  if (c.font_body)     charteParts.push(`police corps "${c.font_body}"`);
  if (charteParts.length) {
    lines.push(`- Charte graphique : ${charteParts.join(', ')}`);
  }

  if (assets.brand_book_url) {
    lines.push(`- Brand book complet (lien externe) : ${assets.brand_book_url}`);
  }
  if (assets.extra_notes) {
    lines.push(`- Notes spéciales du client : "${assets.extra_notes}"`);
  }

  // Sprint Kodex-3.1.5 + amélioration : fichiers uploadés dans le coffre-fort
  const uploads = assets.uploads || [];
  if (uploads.length) {
    lines.push('');
    lines.push('### Fichiers fournis par le client (téléversés dans Kodex) :');
    for (const u of uploads) {
      const sizeKo = u.size_bytes ? Math.round(u.size_bytes / 1024) : '?';
      lines.push(`- **${u.kind || 'autre'}** — ${u.filename} (${u.mime}, ${sizeKo} Ko)`);
    }
    lines.push('');
    lines.push('Ces fichiers sont accessibles via leur URL souveraine Keystone (à transmettre au graphiste avec le brief PDF). Mentionne-les explicitement dans la section "Fichiers à transmettre au graphiste".');
  }

  if (lines.length === 1) return '';   // rien après le titre
  return lines.join('\n');
}

function _renderLegalBlock(sector, fields) {
  const mentions = computeLegalMentions(sector, fields);
  if (!mentions.length) return '';
  const lines = ['### Mentions légales obligatoires à reprendre dans la création :'];
  mentions.forEach((m, i) => lines.push(`${i + 1}. ${m}`));
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// API publique
// ═══════════════════════════════════════════════════════════════

/**
 * Construit le Code Maître à envoyer au moteur AI.
 * @param {object} state   l'état Kodex complet (_state)
 * @param {object} sector  le profil métier hydraté
 * @returns {string}       prompt complet en markdown
 */
export async function buildCodeMaitre(state, sector) {
  const destState = state.destination || {};
  const std = destState.standard;
  const fields = state.content?.fields || {};
  const assets = state.assets || {};

  // v3 vendor-aware : on hydrate l'objet vendor depuis vendor_id pour
  // enrichir le bloc tech avec calques système, noir riche, étapes prep…
  let vendor = null;
  if (destState.vendor_id) {
    try { vendor = await getVendor(destState.vendor_id); }
    catch (_) { vendor = null; }
  }

  const tech    = _renderTechBlock(std, destState, vendor);
  const content = _renderContentBlock(sector, fields);
  const visuel  = _renderAssetsBlock(assets);
  const legal   = _renderLegalBlock(sector, fields);

  const vendorHint = (vendor && vendor.level !== 3)
    ? ` Le client produira chez « ${vendor.label} » (specs commerciales connues — bleed ${std.bleed_mm} mm, ${vendor.color_profile}). Respecte scrupuleusement la préparation décrite section 1.`
    : std?.vendor
      ? ` Le client envisage de produire chez « ${std.vendor} » : la spec officielle de ce prestataire fait foi en cas d'écart — rappelle-le dans le brief.`
      : '';

  return `Tu es un expert en production print et digital, garant du "zéro défaut" de fabrication. Voici un cahier des charges client complet. Ton rôle : produire un BRIEF TECHNIQUE INFAILLIBLE prêt à être envoyé à un graphiste ou un maquettiste.${vendorHint}

# Cahier des charges du client

## 1. Contraintes techniques du support
${tech || '(non spécifiées)'}

## 2. Données métier du projet
${content || '(non renseignées)'}

## 3. Identité visuelle et assets
${visuel || '(non renseignés)'}

## 4. Conformité légale
${legal || '(aucune mention spécifique requise)'}

---

# Ton livrable

Produis un document structuré en deux sections claires (Markdown) :

## SECTION 1 — Brief technique (pour le maquettiste / imprimeur)

Récapitule les éléments techniques de manière professionnelle et synthétique :
- Format, marges, fond perdu, colorimétrie, export
- Particularités d'échelle si grand format
- Mentions légales obligatoires à intégrer
- Liste des assets fournis vs à demander au client
- Recommandations spécifiques liées à la distance de vue

## SECTION 2 — Pistes créatives (pour le directeur communication)

- **5 punchlines marketing courtes** (max 10 mots chacune) inspirées par l'argumentaire client et le format ciblé. Évite les clichés immobiliers. Tonalité : confiante, élégante, en lien avec la promesse.
- **3 angles de direction artistique** différents (ton/atmosphère/structure visuelle).
- **Alertes critiques** que tu détectes (incohérence, manque d'asset, risque technique).

Termine par une checklist en bullet de "Points de validation avant impression". Sois concret et exigeant — ce brief doit faire gagner du temps au graphiste et éviter les erreurs coûteuses.`;
}

/**
 * Vérifie si le state contient les éléments minimum requis pour
 * lancer une génération. Retourne null si OK, sinon un message d'erreur.
 */
export function validateForGeneration(state) {
  const std = state.destination?.standard;
  if (!std) {
    return 'Choisissez un preset ou saisissez vos spécifications dans l\'étape 1.';
  }
  const f = std.format_fini || {};
  const hasDims = (f.width_mm && f.height_mm) || (f.width_px && f.height_px);
  if (!hasDims) {
    return 'Saisissez les dimensions de votre support (étape 1).';
  }
  const fields = state.content?.fields || {};
  const hasContent = Object.values(fields).some(v =>
    v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
  );
  if (!hasContent) {
    return 'Saisissez au moins un champ dans l\'étape 2 (Le message).';
  }
  return null;
}
