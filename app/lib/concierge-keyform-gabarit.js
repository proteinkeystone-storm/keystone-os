// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Gabarit « Fiche établissement » (Key Form -> Concierge)
// ───────────────────────────────────────────────────────────────────
// Sprint C-b. Construit un formulaire Key Form (ex-Pulsa) destiné à un
// commerçant lambda : QUE des champs simples et fixes, AUCUN bloc répétable
// (le répéteur Key Form est une fonction avancée, config-style, incompréhen-
// sible pour un non-technicien — retiré 2026-05-31 sur retour de Stéphane).
//
// Le client remplit ce qu'il veut (jusqu'aux plafonds GABARIT_MAX), laisse le
// reste vide. À l'import, gabaritResponseToSubmission() rassemble les champs
// plats remplis en une submission keyform { cg_items[], cg_faq[], ... } que
// keyformToBlock (Worker) sait dériver en bloc Concierge generic.
//
//   gabarit (champs plats)  ->  client remplit  ->  réponse plate
//        -> gabaritResponseToSubmission -> submission keyform
//        -> coerceKeyform -> éditeur SDQR pré-rempli -> keyformToBlock
//
// Au-delà des plafonds, l'agence complète dans l'éditeur Concierge SDQR (qui,
// lui, garde des répéteurs « + Ajouter » familiers côté admin).
// ══════════════════════════════════════════════════════════════════

import { newForm, newField, newSection } from './pulsa-types.js';

// Pivot de détection : un Key Form est une « Fiche établissement » ssi il
// contient un champ portant cet id (== KEYFORM_GABARIT_FIELDS.nom_enseigne).
export const CONCIERGE_GABARIT_PIVOT_ID = 'cg_nom_enseigne';

// Plafonds (format « Compact » validé par Stéphane 2026-05-31). Le reste se
// complète dans l'éditeur Concierge SDQR après import.
export const GABARIT_MAX = { offres: 4, faq: 4, suggestions: 3 };

// Champ Key Form à id FIXE (l'id auto fld_* de newField est remplacé).
function fixedField(id, type, label, { required = false, placeholder = '', width = 'full' } = {}) {
  const f = newField(type);
  f.id = id;
  f.label = label;
  f.width = width;
  if (required) f.required = true;
  if (placeholder && f.options && 'placeholder' in f.options) f.options.placeholder = placeholder;
  return f;
}

/**
 * Construit le formulaire Key Form « Fiche établissement » (objet Pulsa
 * { meta, sections }). Que des champs plats simples (text-short/long/email).
 */
export function buildConciergeFicheGabarit() {
  const form = newForm();
  form.meta.title = 'Fiche établissement';
  form.meta.slug  = 'fiche-etablissement';
  form.meta.intro = 'Renseignez les informations de votre établissement. '
    + 'Elles alimenteront votre Concierge : la page de réponses automatiques '
    + 'qui s\'affiche quand un visiteur scanne votre QR code. Remplissez ce qui '
    + 'vous concerne, laissez vide le reste.';

  // 1 — L'établissement (enseigne requise = pivot + validation generic)
  const sEtab = newSection('L\'établissement');
  sEtab.subtitle = 'Identité et accroche de votre établissement.';
  sEtab.fields.push(
    fixedField('cg_nom_enseigne', 'text-short', 'Nom de l\'établissement / enseigne',
      { required: true, placeholder: 'Ex : Bowling de Bandol' }),
    fixedField('cg_titre_offre', 'text-short', 'Accroche / phrase principale',
      { placeholder: 'Ex : Le spot loisirs de la baie' }),
    fixedField('cg_ville', 'text-short', 'Ville', { placeholder: 'Ex : Bandol' }),
    fixedField('cg_adresse', 'text-short', 'Adresse', { placeholder: 'Ex : 12 avenue du Port, 83150 Bandol' }),
  );
  form.sections.push(sEtab);

  // 2 — Vos offres : champs plats fixes (jusqu'à GABARIT_MAX.offres).
  // 1re offre requise (au moins une offre = exigée par validateGeneric).
  const sOffres = newSection(`Vos offres (jusqu'à ${GABARIT_MAX.offres})`);
  sOffres.subtitle = 'Remplissez les offres que vous proposez, laissez les autres vides.';
  for (let i = 1; i <= GABARIT_MAX.offres; i++) {
    sOffres.fields.push(
      fixedField(`cg_offre${i}_nom`, 'text-short', `Offre ${i} — nom`,
        { required: i === 1, placeholder: i === 1 ? 'Ex : Partie de bowling' : '', width: '1/2' }),
      fixedField(`cg_offre${i}_prix`, 'text-short', `Offre ${i} — prix / tarif`,
        { placeholder: i === 1 ? 'Ex : 6 € la partie' : '', width: '1/2' }),
      fixedField(`cg_offre${i}_desc`, 'text-long', `Offre ${i} — description`,
        { placeholder: i === 1 ? 'Ce qui est inclus, conditions...' : '' }),
    );
  }
  form.sections.push(sOffres);

  // 3 — Questions fréquentes : paires Q/R plates (jusqu'à GABARIT_MAX.faq).
  const sFaq = newSection(`Questions fréquentes (jusqu'à ${GABARIT_MAX.faq})`);
  sFaq.subtitle = 'Les questions/réponses que votre Concierge pourra citer.';
  for (let i = 1; i <= GABARIT_MAX.faq; i++) {
    sFaq.fields.push(
      fixedField(`cg_faq${i}_q`, 'text-short', `Question ${i}`,
        { placeholder: i === 1 ? 'Ex : Quels sont vos horaires ?' : '' }),
      fixedField(`cg_faq${i}_r`, 'text-long', `Réponse ${i}`,
        { placeholder: i === 1 ? 'Ex : Ouvert 7j/7 de 10h a minuit.' : '' }),
    );
  }
  form.sections.push(sFaq);

  // 4 — Questions à suggérer aux visiteurs (jusqu'à GABARIT_MAX.suggestions).
  const sQ = newSection(`Questions à suggérer aux visiteurs (jusqu'à ${GABARIT_MAX.suggestions})`);
  sQ.subtitle = 'Les puces proposées au visiteur sur la page Concierge.';
  for (let i = 1; i <= GABARIT_MAX.suggestions; i++) {
    sQ.fields.push(
      fixedField(`cg_sugg${i}`, 'text-short', `Suggestion ${i}`,
        { placeholder: i === 1 ? 'Ex : Comment reserver ?' : '' }),
    );
  }
  form.sections.push(sQ);

  // 5 — Contact
  const sContact = newSection('Contact');
  sContact.subtitle = 'Vers qui orienter le visiteur.';
  sContact.fields.push(
    fixedField('cg_contact_nom',   'text-short', 'Nom du contact', { placeholder: 'Ex : Camille Martin', width: '1/2' }),
    fixedField('cg_contact_tel',   'text-short', 'Téléphone',      { placeholder: 'Ex : 04 94 00 00 00', width: '1/2' }),
    fixedField('cg_contact_email', 'email',      'Email',          { placeholder: 'Ex : contact@etablissement.fr' }),
  );
  form.sections.push(sContact);

  // 6 — Mention légale
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
 * établissement, détecté via le champ pivot.
 */
export function isConciergeGabarit(form) {
  if (!form || !Array.isArray(form.sections)) return false;
  return form.sections.some((sec) =>
    Array.isArray(sec && sec.fields) &&
    sec.fields.some((f) => f && f.id === CONCIERGE_GABARIT_PIVOT_ID));
}

/**
 * Assemble une réponse PLATE au gabarit (cg_offre1_nom, cg_faq1_q, cg_sugg1…)
 * en une submission keyform { cg_items[], cg_faq[], cg_questions[], … } prête
 * pour coerceKeyform/keyformToBlock. Ne garde que les lignes non vides.
 * Rétro-compat : si la réponse contient déjà des tableaux cg_items/cg_faq/
 * cg_questions (ancien gabarit répéteur), on les conserve tels quels.
 */
export function gabaritResponseToSubmission(responseValues) {
  const s = (responseValues && typeof responseValues === 'object' && !Array.isArray(responseValues))
    ? responseValues : {};
  const str = (v) => (v == null ? '' : String(v));

  let items = Array.isArray(s.cg_items) && s.cg_items.length ? s.cg_items : null;
  if (!items) {
    items = [];
    for (let i = 1; i <= GABARIT_MAX.offres; i++) {
      const nom  = str(s[`cg_offre${i}_nom`]).trim();
      const prix = str(s[`cg_offre${i}_prix`]).trim();
      const desc = str(s[`cg_offre${i}_desc`]).trim();
      if (nom || prix || desc) items.push({ item_nom: nom, item_prix: prix, item_desc: desc });
    }
  }

  let faq = Array.isArray(s.cg_faq) && s.cg_faq.length ? s.cg_faq : null;
  if (!faq) {
    faq = [];
    for (let i = 1; i <= GABARIT_MAX.faq; i++) {
      const q = str(s[`cg_faq${i}_q`]).trim();
      const r = str(s[`cg_faq${i}_r`]).trim();
      if (q || r) faq.push({ faq_q: q, faq_r: r });
    }
  }

  let questions = Array.isArray(s.cg_questions) && s.cg_questions.length ? s.cg_questions : null;
  if (!questions) {
    questions = [];
    for (let i = 1; i <= GABARIT_MAX.suggestions; i++) {
      const q = str(s[`cg_sugg${i}`]).trim();
      if (q) questions.push(q);
    }
  }

  return {
    cg_nom_enseigne:  str(s.cg_nom_enseigne),
    cg_titre_offre:   str(s.cg_titre_offre),
    cg_ville:         str(s.cg_ville),
    cg_adresse:       str(s.cg_adresse),
    cg_items:         items,
    cg_faq:           faq,
    cg_questions:     questions,
    cg_contact_nom:   str(s.cg_contact_nom),
    cg_contact_tel:   str(s.cg_contact_tel),
    cg_contact_email: str(s.cg_contact_email),
    cg_disclaimer:    str(s.cg_disclaimer),
  };
}
