// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Gabarit « Fiche établissement » (Key Form -> Concierge)
// ───────────────────────────────────────────────────────────────────
// Sprint C-b. Construit un formulaire Key Form (ex-Pulsa) PRÉ-CÂBLÉ au
// Concierge générique : chaque champ porte un id == une clé de
// KEYFORM_GABARIT_FIELDS (workers/.../concierge-schema.js). Conséquence :
// une RÉPONSE à ce formulaire (les valeurs sont keyées par field.id, cf.
// pulsa.js submit) EST DÉJÀ une « submission keyform » plate, directement
// consommable par keyformToBlock — ZÉRO logique de mapping à l'import.
//
//   gabarit (cg_* ids)  ->  client remplit  ->  réponse {cg_*: valeur}
//                                            == submission keyform
//                                            -> keyformToBlock -> bloc generic
//
// L'agence crée ce gabarit (instanciation type Kodex : newForm + saveForm +
// openPulsa), le publie dans Key Form, le partage ; l'import SDQR récupère la
// dernière réponse et pré-remplit l'éditeur générique existant.
//
// IMPORTANT : les ids ci-dessous DOIVENT rester alignés sur
// KEYFORM_GABARIT_FIELDS. Le test scripts/test-templates.mjs (section D4)
// est le linchpin anti-dérive : il casse si un id diverge du contrat.
// ══════════════════════════════════════════════════════════════════

import { newForm, newField, newSection } from './pulsa-types.js';

// Pivot de détection : un Key Form est une « Fiche établissement » (gabarit
// Concierge) ssi il contient un champ portant cet id. Doit valoir
// KEYFORM_GABARIT_FIELDS.nom_enseigne.
export const CONCIERGE_GABARIT_PIVOT_ID = 'cg_nom_enseigne';

// Crée un champ Key Form à id FIXE (les ids auto fld_* de newField sont
// remplacés par nos ids de contrat cg_* / item_* / faq_*).
function fixedField(id, type, label, { required = false, placeholder = '' } = {}) {
  const f = newField(type);
  f.id = id;
  f.label = label;
  if (required) f.required = true;
  if (placeholder && f.options && 'placeholder' in f.options) f.options.placeholder = placeholder;
  return f;
}

function repeaterField(id, label, { item_label, add_label, min = 0, fields }) {
  const f = newField('repeater');
  f.id = id;
  f.label = label;
  f.options.item_label = item_label;
  f.options.add_label  = add_label;
  f.options.min = min;
  f.options.max = 0;            // 0 = pas de limite
  f.options.fields = fields;    // sous-champs à ids fixes
  return f;
}

/**
 * Construit le formulaire Key Form « Fiche établissement » (objet Pulsa
 * complet : { meta, sections }). Tous les champs collectés alimentent un
 * bloc Concierge générique valide (enseigne + au moins une offre = requis
 * par validateGeneric ; le reste est optionnel).
 */
export function buildConciergeFicheGabarit() {
  const form = newForm();
  form.meta.title = 'Fiche établissement';
  form.meta.slug  = 'fiche-etablissement';
  form.meta.intro = 'Renseignez les informations de votre établissement. '
    + 'Elles alimenteront votre Concierge : la page de réponses automatiques '
    + 'qui s\'affiche quand un visiteur scanne votre QR code.';

  // 1 — L'établissement (enseigne requise = pivot + validation generic)
  const sEtab = newSection('L\'établissement');
  sEtab.subtitle = 'Identité et accroche de votre établissement.';
  sEtab.fields.push(
    fixedField('cg_nom_enseigne', 'text-short', 'Nom de l\'établissement / enseigne',
      { required: true, placeholder: 'Ex : Bowling de Bandol' }),
    fixedField('cg_titre_offre', 'text-short', 'Accroche / phrase principale',
      { placeholder: 'Ex : Le spot loisirs de la baie' }),
    fixedField('cg_ville', 'text-short', 'Ville',
      { placeholder: 'Ex : Bandol' }),
  );
  form.sections.push(sEtab);

  // 2 — Vos offres (repeater ; au moins une offre avec un intitulé = requis)
  const sOffres = newSection('Vos offres');
  sOffres.subtitle = 'Ajoutez chaque offre, formule ou prestation (au moins une).';
  sOffres.fields.push(repeaterField('cg_items', 'Offres', {
    item_label: 'Offre',
    add_label:  'Ajouter une offre',
    min: 1,
    fields: [
      fixedField('item_nom',  'text-short', 'Nom de l\'offre', { placeholder: 'Ex : Partie de bowling' }),
      fixedField('item_prix', 'text-short', 'Prix / tarif',     { placeholder: 'Ex : 6 € la partie' }),
      fixedField('item_desc', 'text-long',  'Description',       { placeholder: 'Ce qui est inclus, conditions...' }),
    ],
  }));
  form.sections.push(sOffres);

  // 3 — Questions fréquentes (repeater optionnel) -> faq_validee
  const sFaq = newSection('Questions fréquentes');
  sFaq.subtitle = 'Les questions/réponses que votre Concierge pourra citer telles quelles.';
  sFaq.fields.push(repeaterField('cg_faq', 'FAQ', {
    item_label: 'Question/réponse',
    add_label:  'Ajouter une question',
    min: 0,
    fields: [
      fixedField('faq_q', 'text-short', 'Question', { placeholder: 'Ex : Quels sont vos horaires ?' }),
      fixedField('faq_r', 'text-long',  'Réponse',  { placeholder: 'Ex : Ouvert 7j/7 de 10h a minuit.' }),
    ],
  }));
  form.sections.push(sFaq);

  // 4 — Questions à suggérer aux visiteurs (repeater optionnel)
  const sQ = newSection('Questions à suggérer aux visiteurs');
  sQ.subtitle = 'Les puces proposées au visiteur sur la page Concierge.';
  sQ.fields.push(repeaterField('cg_questions', 'Questions suggérées', {
    item_label: 'Question',
    add_label:  'Ajouter une question',
    min: 0,
    fields: [
      fixedField('cg_question', 'text-short', 'Question suggérée', { placeholder: 'Ex : Comment reserver ?' }),
    ],
  }));
  form.sections.push(sQ);

  // 5 — Contact (vers qui orienter le visiteur)
  const sContact = newSection('Contact');
  sContact.subtitle = 'Vers qui orienter le visiteur.';
  sContact.fields.push(
    fixedField('cg_contact_nom',   'text-short', 'Nom du contact', { placeholder: 'Ex : Camille Martin' }),
    fixedField('cg_contact_tel',   'text-short', 'Téléphone',      { placeholder: 'Ex : 04 94 00 00 00' }),
    fixedField('cg_contact_email', 'email',      'Email',          { placeholder: 'Ex : contact@etablissement.fr' }),
  );
  form.sections.push(sContact);

  // 6 — Mention légale -> disclaimer
  const sLegal = newSection('Mention légale');
  sLegal.subtitle = 'Affichée en bas de la page Concierge.';
  sLegal.fields.push(
    fixedField('cg_disclaimer', 'text-long', 'Disclaimer', { placeholder: 'Ex : Informations non contractuelles.' }),
  );
  form.sections.push(sLegal);

  return form;
}

/**
 * Vrai si `form` (objet Key Form { sections:[{fields:[]}] }) est une Fiche
 * établissement (gabarit Concierge), détecté via le champ pivot.
 */
export function isConciergeGabarit(form) {
  if (!form || !Array.isArray(form.sections)) return false;
  return form.sections.some((sec) =>
    Array.isArray(sec && sec.fields) &&
    sec.fields.some((f) => f && f.id === CONCIERGE_GABARIT_PIVOT_ID));
}

/**
 * Passe-plat défensif : une réponse de gabarit est DÉJÀ keyée par cg_* (ids
 * des champs), donc directement consommable par keyformToBlock. Cette
 * fonction centralise ce contrat (point unique si la forme évolue).
 */
export function gabaritResponseToSubmission(responseValues) {
  return (responseValues && typeof responseValues === 'object' && !Array.isArray(responseValues))
    ? responseValues
    : {};
}
