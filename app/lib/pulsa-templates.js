/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key Form (Pulsa) · Bibliothèque de Modèles
   ─────────────────────────────────────────────────────────────
   13 modèles prêts à l'emploi, rangés par familles. Chaque modèle
   est une STRUCTURE COMPLÈTE (sections + champs + options pré-réglées)
   que l'utilisateur instancie en 1 clic puis personnalise librement
   (tout est modulable : champs, textes, branding, logique).

   Remplace l'ancien exemple unique « VEFA / immobilier » (pulsa-demo.js).

   Le modèle « Fiche établissement » réutilise le gabarit officiel
   buildConciergeFicheGabarit() → champs cg_* garantis importables
   dans un Smart QR Concierge.
   ═══════════════════════════════════════════════════════════════ */

import { FIELD_TYPES, newForm } from './pulsa-types.js';
import { buildConciergeFicheGabarit } from './concierge-keyform-gabarit.js';

// ── Helpers d'écriture concise ────────────────────────────────
// F(id, type, label, opts) : champ complet. opts = { required, width,
// help, visible_if, required_if, compute_from } + toute option propre
// au type (placeholder, choices, currency, yes_label, fields…).
function F(id, type, label, opts = {}) {
  const {
    required = false, width = 'full', help = '',
    visible_if = null, required_if = null, compute_from = null,
    ...optionOverrides
  } = opts;
  const def = FIELD_TYPES[type];
  const base = def ? structuredClone(def.defaults) : {};
  return {
    id, type, label, help, required, width,
    options: { ...base, ...optionOverrides },
    visible_if, required_if, compute_from,
  };
}

function S(id, title, subtitle, fields) {
  return { id, title, subtitle: subtitle || '', fields, visible_if: null };
}

function FORM(meta, sections, notification_subject = '') {
  const f = newForm();
  f.meta.title       = meta.title;
  f.meta.intro       = meta.intro || '';
  f.meta.anonymous   = meta.anonymous !== false ? (meta.anonymous ?? true) : false;
  f.meta.ttl_days    = meta.ttl_days ?? 90;
  f.meta.access_code = meta.access_code ?? null;
  if (meta.brand_gradient) f.meta.brand_gradient = meta.brand_gradient;
  f.sections = sections;
  f.delivery.notification_subject = notification_subject;
  return f;
}

// Dégradés de marque par famille (purement esthétique, 100% modulable
// par l'utilisateur ensuite via l'étape Apparence).
const G = {
  contrats:   'linear-gradient(135deg, #1f2937 0%, #0f172a 100%)',
  commercial: 'linear-gradient(135deg, #0a2741 0%, #1c4870 100%)',
  relation:   'linear-gradient(135deg, #134e4a 0%, #0f766e 100%)',
  mesure:     'linear-gradient(135deg, #3730a3 0%, #4f46e5 100%)',
};

// ── Familles (pour le rangement dans la galerie) ──────────────
export const TEMPLATE_CATEGORIES = [
  { id: 'contrats',   label: 'Contrats & signatures' },
  { id: 'commercial', label: 'Commercial & devis' },
  { id: 'relation',   label: 'Relation client' },
  { id: 'mesure',     label: 'Mesure & décision' },
];

// ═══════════════════════════════════════════════════════════════
// LES 13 MODÈLES
// ═══════════════════════════════════════════════════════════════
export const KEYFORM_TEMPLATES = [

  // ───────── A. CONTRATS & SIGNATURES ─────────
  {
    id: 'etat-des-lieux',
    category: 'contrats',
    name: 'État des lieux (meublé / saisonnier)',
    ico: 'check-square',
    description: "Constat d'entrée ou de sortie pièce par pièce, inventaire du mobilier et relevés de compteurs, avec double signature bailleur / locataire.",
    form: FORM(
      { title: 'État des lieux — location meublée', anonymous: false, ttl_days: 365, brand_gradient: G.contrats,
        intro: "Constat contradictoire d'état des lieux. Renseignez chaque pièce, l'inventaire du mobilier et les relevés, puis signez en bas." },
      [
        S('sec_parties', 'Le logement & les parties', "", [
          F('fld_type', 'chips', "Type d'état des lieux", { required: true, choices: [ { id: 'entree', label: "Entrée" }, { id: 'sortie', label: "Sortie" } ] }),
          F('fld_bien', 'text-short', "Logement (adresse / désignation)", { required: true, placeholder: "Ex : Studio 24 — 12 rue du Port" }),
          F('fld_bailleur', 'text-short', "Bailleur", { required: true, width: '1/2', placeholder: "Nom du bailleur" }),
          F('fld_locataire', 'text-short', "Locataire", { required: true, width: '1/2', placeholder: "Nom du locataire" }),
          F('fld_date', 'date', "Date de l'état des lieux", { required: true, width: '1/2' }),
          F('fld_cles', 'text-short', "Nombre de clés / badges remis", { width: '1/2', placeholder: "Ex : 2 clés + 1 badge" }),
        ]),
        S('sec_compteurs', 'Relevés de compteurs', "", [
          F('fld_eau', 'text-short', "Eau (m³)", { width: '1/2', placeholder: "Relevé" }),
          F('fld_elec', 'text-short', "Électricité (kWh)", { width: '1/2', placeholder: "Relevé" }),
          F('fld_gaz', 'text-short', "Gaz (m³)", { width: '1/2', placeholder: "Relevé (si applicable)" }),
        ]),
        S('sec_pieces', 'État pièce par pièce', "Ajoutez autant de pièces que nécessaire.", [
          F('fld_pieces', 'repeater', "Pièces", { item_label: 'Pièce', add_label: "Ajouter une pièce", min: 1, max: 0, fields: [
            F('rp_nom', 'text-short', "Pièce", { placeholder: "Ex : Salon, Chambre, Cuisine…" }),
            F('rp_etat', 'chips', "État général", { choices: [ { id: 'bon', label: "Bon" }, { id: 'moyen', label: "Moyen" }, { id: 'mauvais', label: "Mauvais" } ] }),
            F('rp_obs', 'text-long', "Observations", { placeholder: "Détails, défauts constatés…", max_chars: 400, rows: 3 }),
            F('rp_photo', 'url-external', "Photo (lien)", { placeholder: "Lien Drive / WeTransfer…" }),
          ] }),
        ]),
        S('sec_inventaire', 'Inventaire du mobilier', "Listez le mobilier et équipements fournis.", [
          F('fld_inventaire', 'repeater', "Mobilier", { item_label: 'Élément', add_label: "Ajouter un élément", min: 0, max: 0, fields: [
            F('ri_design', 'text-short', "Désignation", { placeholder: "Ex : Canapé, Lave-linge…" }),
            F('ri_qte', 'text-short', "Quantité", { placeholder: "Ex : 1" }),
            F('ri_etat', 'chips', "État", { choices: [ { id: 'neuf', label: "Neuf" }, { id: 'bon', label: "Bon" }, { id: 'use', label: "Usagé" } ] }),
          ] }),
        ]),
        S('sec_validation', 'Validation', "", [
          F('fld_remarques', 'text-long', "Remarques générales", { placeholder: "Observations complémentaires…", max_chars: 800, rows: 3 }),
          F('fld_sign_bailleur', 'signature', "Signature du bailleur", { required: true, width: '1/2' }),
          F('fld_sign_locataire', 'signature', "Signature du locataire", { required: true, width: '1/2' }),
        ]),
      ],
      "État des lieux complété",
    ),
  },

  {
    id: 'nda',
    category: 'contrats',
    name: 'Accord de confidentialité (NDA)',
    ico: 'file-text',
    description: "Engagement de confidentialité généraliste : parties, clauses en lecture seule, acceptation explicite et signature horodatée.",
    form: FORM(
      { title: 'Accord de confidentialité', anonymous: false, ttl_days: 730, brand_gradient: G.contrats,
        intro: "Merci de lire l'engagement de confidentialité ci-dessous, puis de le valider et de le signer." },
      [
        S('sec_parties', 'Les parties', "", [
          F('fld_societe', 'text-short', "Société / entité émettrice", { required: true, placeholder: "Votre société" }),
          F('fld_signataire', 'text-short', "Nom du signataire", { required: true, width: '1/2', placeholder: "Prénom Nom" }),
          F('fld_qualite', 'text-short', "Qualité / fonction", { required: true, width: '1/2', placeholder: "Ex : Gérant, Prestataire…" }),
          F('fld_email', 'email', "Email", { required: true }),
        ]),
        S('sec_termes', "Engagement de confidentialité", "", [
          F('fld_termes', 'brief-readonly', "Termes de l'accord", { source: 'template', heading: "Engagement de confidentialité",
            brief_text: "Le signataire s'engage à conserver strictement confidentielles toutes les informations, documents et données auxquels il aura accès dans le cadre de la relation avec la société émettrice.\n\nCes informations ne pourront être divulguées à des tiers ni utilisées à d'autres fins que celles convenues, sans accord écrit préalable.\n\nCet engagement reste valable pendant toute la durée de la relation et se prolonge après son terme. (Adaptez librement ce texte à votre situation.)" }),
        ]),
        S('sec_acceptation', 'Acceptation & signature', "", [
          F('fld_lu', 'yes-no', "Je reconnais avoir lu et compris les termes ci-dessus", { required: true, yes_label: "Oui, j'accepte", no_label: "Non" }),
          F('fld_date', 'date', "Date", { required: true, width: '1/2' }),
          F('fld_signature', 'signature', "Signature", { required: true }),
        ]),
      ],
      "Accord de confidentialité signé",
    ),
  },

  {
    id: 'engagement',
    category: 'contrats',
    name: "Lettre d'engagement",
    ico: 'edit',
    description: "Engagement généraliste (prestation, partenariat, mission) : objet, obligations, montant et échéance, validé par signature.",
    form: FORM(
      { title: "Lettre d'engagement", anonymous: false, ttl_days: 730, brand_gradient: G.contrats,
        intro: "Formalisez votre engagement : renseignez l'objet, prenez connaissance des obligations, puis validez et signez." },
      [
        S('sec_identite', 'Identité', "", [
          F('fld_nom', 'text-short', "Nom du signataire", { required: true, width: '1/2', placeholder: "Prénom Nom" }),
          F('fld_qualite', 'text-short', "Qualité", { width: '1/2', placeholder: "Ex : Gérant" }),
          F('fld_societe', 'text-short', "Société (le cas échéant)", { placeholder: "Raison sociale" }),
          F('fld_email', 'email', "Email", { required: true }),
        ]),
        S('sec_objet', "Objet & obligations", "", [
          F('fld_cadre', 'brief-readonly', "Cadre de l'engagement", { source: 'template', heading: "Obligations",
            brief_text: "Le signataire s'engage à exécuter de bonne foi les obligations décrites ci-dessous, dans les délais convenus et selon les conditions financières précisées. (Personnalisez ce bloc selon votre contexte.)" }),
          F('fld_objet', 'text-long', "Objet de l'engagement", { required: true, placeholder: "Décrivez précisément l'engagement pris…", max_chars: 1200, rows: 5 }),
          F('fld_montant', 'amount', "Montant convenu", { width: '1/2', currency: 'EUR', decimals: 2 }),
          F('fld_echeance', 'date', "Échéance", { width: '1/2' }),
        ]),
        S('sec_validation', 'Validation', "", [
          F('fld_accepte', 'yes-no', "Je m'engage sur les termes ci-dessus", { required: true, yes_label: "Je m'engage", no_label: "Non" }),
          F('fld_date', 'date', "Date", { required: true, width: '1/2' }),
          F('fld_signature', 'signature', "Signature", { required: true }),
        ]),
      ],
      "Engagement signé",
    ),
  },

  {
    id: 'droit-image',
    category: 'contrats',
    name: "Autorisation de droit à l'image",
    ico: 'image',
    description: "Recueil d'autorisation d'utilisation de l'image (supports, durée), avec cas du mineur géré automatiquement, et signature.",
    form: FORM(
      { title: "Autorisation de droit à l'image", anonymous: false, ttl_days: 1095, brand_gradient: G.contrats,
        intro: "Cette autorisation permet l'utilisation de votre image dans les conditions précisées ci-dessous." },
      [
        S('sec_personne', 'Personne concernée', "", [
          F('fld_prenom', 'text-short', "Prénom", { required: true, width: '1/2' }),
          F('fld_nom', 'text-short', "Nom", { required: true, width: '1/2' }),
          F('fld_email', 'email', "Email", { required: true }),
          F('fld_mineur', 'yes-no', "La personne est-elle mineure ?", { required: true, yes_label: "Oui", no_label: "Non" }),
          F('fld_representant', 'text-short', "Nom du représentant légal", { placeholder: "Parent / tuteur",
            visible_if:  { field: 'fld_mineur', op: 'eq', value: 'yes' },
            required_if: { field: 'fld_mineur', op: 'eq', value: 'yes' } }),
        ]),
        S('sec_autorisation', "Étendue de l'autorisation", "", [
          F('fld_supports', 'cards', "Supports autorisés (plusieurs possibles)", { required: true, min: 1, max: null, choices: [
            { id: 'web', label: "Site web", ico: 'globe', desc: "Pages du site" },
            { id: 'rs', label: "Réseaux sociaux", ico: 'sparkles', desc: "Publications & stories" },
            { id: 'print', label: "Print", ico: 'file-text', desc: "Brochures, affiches" },
            { id: 'presse', label: "Presse", ico: 'edit', desc: "Communiqués, articles" },
          ] }),
          F('fld_duree', 'chips', "Durée de l'autorisation", { required: true, choices: [ { id: '1an', label: "1 an" }, { id: '5ans', label: "5 ans" }, { id: 'illimitee', label: "Illimitée" } ] }),
          F('fld_contexte', 'text-long', "Contexte d'utilisation", { placeholder: "Ex : reportage événement, campagne…", max_chars: 500, rows: 3 }),
        ]),
        S('sec_consentement', 'Consentement & signature', "", [
          F('fld_consent', 'yes-no', "J'autorise l'utilisation de mon image dans les conditions ci-dessus", { required: true, yes_label: "J'autorise", no_label: "Je refuse" }),
          F('fld_date', 'date', "Date", { required: true, width: '1/2' }),
          F('fld_signature', 'signature', "Signature", { required: true }),
        ]),
      ],
      "Autorisation de droit à l'image signée",
    ),
  },

  // ───────── B. COMMERCIAL & DEVIS ─────────
  {
    id: 'devis',
    category: 'commercial',
    name: 'Demande de devis',
    ico: 'package',
    description: "Le client décrit son besoin ligne par ligne, son budget et son échéance — vous recevez tout le nécessaire pour chiffrer.",
    form: FORM(
      { title: 'Demande de devis', anonymous: false, ttl_days: 90, brand_gradient: G.commercial,
        intro: "Décrivez votre besoin le plus précisément possible : nous reviendrons vers vous avec une proposition chiffrée." },
      [
        S('sec_coordonnees', 'Vos coordonnées', "", [
          F('fld_nom', 'text-short', "Nom", { required: true, width: '1/2' }),
          F('fld_societe', 'text-short', "Société", { width: '1/2' }),
          F('fld_email', 'email', "Email", { required: true, width: '1/2' }),
          F('fld_tel', 'text-short', "Téléphone", { width: '1/2', placeholder: "06 …" }),
        ]),
        S('sec_besoin', 'Votre besoin', "Ajoutez une ligne par élément souhaité.", [
          F('fld_prestation', 'cards', "Type de prestation (plusieurs possibles)", { min: 1, max: null, choices: [
            { id: 'creation', label: "Création", ico: 'sparkles', desc: "Conception, design" },
            { id: 'production', label: "Production", ico: 'package', desc: "Fabrication, réalisation" },
            { id: 'conseil', label: "Conseil", ico: 'edit', desc: "Accompagnement" },
          ] }),
          F('fld_lignes', 'repeater', "Lignes de la demande", { item_label: 'Ligne', add_label: "Ajouter une ligne", min: 1, max: 0, fields: [
            F('rl_design', 'text-short', "Désignation", { placeholder: "Ex : Visuel 3D façade" }),
            F('rl_qte', 'text-short', "Quantité", { placeholder: "Ex : 3" }),
            F('rl_details', 'text-long', "Précisions", { placeholder: "Détails utiles au chiffrage…", max_chars: 300, rows: 2 }),
          ] }),
          F('fld_budget', 'amount', "Budget approximatif (optionnel)", { width: '1/2', currency: 'EUR', decimals: 0 }),
          F('fld_delai', 'date', "Échéance souhaitée", { width: '1/2' }),
        ]),
        S('sec_precisions', 'Précisions', "", [
          F('fld_contexte', 'text-long', "Contexte du projet", { placeholder: "Tout ce qui peut nous aider à bien chiffrer…", max_chars: 800, rows: 4 }),
          F('fld_pieces', 'url-external', "Cahier des charges / fichiers (lien)", { placeholder: "Lien Drive / WeTransfer…" }),
        ]),
      ],
      "Nouvelle demande de devis",
    ),
  },

  {
    id: 'rdv',
    category: 'commercial',
    name: 'Prise de rendez-vous',
    ico: 'history',
    description: "Réservation d'un créneau : type de rendez-vous, date et moment souhaités, canal (sur place / téléphone / visio) et motif.",
    form: FORM(
      { title: 'Prise de rendez-vous', anonymous: false, ttl_days: 90, brand_gradient: G.commercial,
        intro: "Indiquez vos disponibilités : nous confirmons le rendez-vous au plus vite." },
      [
        S('sec_coordonnees', 'Vos coordonnées', "", [
          F('fld_nom', 'text-short', "Nom", { required: true, width: '1/2' }),
          F('fld_tel', 'text-short', "Téléphone", { required: true, width: '1/2', placeholder: "06 …" }),
          F('fld_email', 'email', "Email", { required: true }),
        ]),
        S('sec_rdv', 'Votre rendez-vous', "", [
          F('fld_service', 'chips', "Type de rendez-vous", { required: true, choices: [ { id: 'decouverte', label: "Découverte" }, { id: 'devis', label: "Devis" }, { id: 'suivi', label: "Suivi" }, { id: 'autre', label: "Autre" } ] }),
          F('fld_date', 'date', "Date souhaitée", { required: true, width: '1/2' }),
          F('fld_moment', 'chips', "Moment de la journée", { required: true, width: '1/2', choices: [ { id: 'matin', label: "Matin" }, { id: 'midi', label: "Midi" }, { id: 'aprem', label: "Après-midi" }, { id: 'soir', label: "Soir" } ] }),
          F('fld_canal', 'chips', "Canal", { required: true, choices: [ { id: 'place', label: "Sur place" }, { id: 'tel', label: "Téléphone" }, { id: 'visio', label: "Visio" } ] }),
        ]),
        S('sec_motif', 'Précisions', "", [
          F('fld_motif', 'text-long', "Motif / sujet du rendez-vous", { placeholder: "En quelques mots…", max_chars: 500, rows: 3 }),
        ]),
      ],
      "Nouvelle demande de rendez-vous",
    ),
  },

  // ───────── C. RELATION CLIENT ─────────
  {
    id: 'onboarding',
    category: 'relation',
    name: 'Onboarding client',
    ico: 'sparkles',
    description: "Collecte en une fois toutes les infos d'un nouveau client : entreprise, contacts, réseaux, objectifs et accès à la marque.",
    form: FORM(
      { title: 'Onboarding client', anonymous: false, ttl_days: 365, brand_gradient: G.relation,
        intro: "Bienvenue ! Ces informations nous permettent de démarrer votre projet sur de bonnes bases." },
      [
        S('sec_entreprise', "L'entreprise", "", [
          F('fld_societe', 'text-short', "Nom de l'entreprise", { required: true }),
          F('fld_secteur', 'text-short', "Secteur d'activité", { width: '1/2', placeholder: "Ex : Immobilier" }),
          F('fld_site', 'website', "Site web", { width: '1/2', placeholder: "https://…" }),
          F('fld_reseaux', 'social-links', "Réseaux sociaux", {}),
        ]),
        S('sec_contacts', 'Interlocuteurs', "Ajoutez les personnes à contacter.", [
          F('fld_contacts', 'repeater', "Contacts", { item_label: 'Contact', add_label: "Ajouter un contact", min: 1, max: 0, fields: [
            F('rc_nom', 'text-short', "Nom"),
            F('rc_fonction', 'text-short', "Fonction"),
            F('rc_email', 'text-short', "Email", { placeholder: "prenom@societe.fr" }),
            F('rc_tel', 'text-short', "Téléphone"),
          ] }),
        ]),
        S('sec_projet', "Projet & marque", "", [
          F('fld_objectifs', 'text-long', "Vos objectifs", { required: true, placeholder: "Ce que vous attendez de cette collaboration…", max_chars: 1000, rows: 4 }),
          F('fld_logo', 'url-external', "Logo & éléments de marque (lien)", { placeholder: "Lien Drive / WeTransfer…" }),
          F('fld_a_charte', 'yes-no', "Avez-vous une charte graphique ?", { yes_label: "Oui", no_label: "Non" }),
          F('fld_charte', 'url-external', "Lien vers la charte", { placeholder: "Lien Drive…",
            visible_if: { field: 'fld_a_charte', op: 'eq', value: 'yes' } }),
        ]),
      ],
      "Nouveau client — onboarding",
    ),
  },

  {
    id: 'reclamation',
    category: 'relation',
    name: 'Réclamation / SAV',
    ico: 'refresh',
    description: "Ticket de réclamation : catégorie, urgence, description détaillée, pièce jointe et solution attendue.",
    form: FORM(
      { title: 'Réclamation / SAV', anonymous: false, ttl_days: 365, brand_gradient: G.relation,
        intro: "Nous sommes désolés pour la gêne occasionnée. Décrivez votre problème : nous le traitons au plus vite." },
      [
        S('sec_coordonnees', 'Vos coordonnées', "", [
          F('fld_nom', 'text-short', "Nom", { required: true, width: '1/2' }),
          F('fld_email', 'email', "Email", { required: true, width: '1/2' }),
          F('fld_ref', 'text-short', "Référence commande / contrat", { placeholder: "Si vous l'avez" }),
        ]),
        S('sec_reclamation', 'Votre réclamation', "", [
          F('fld_categorie', 'chips', "Catégorie", { required: true, choices: [ { id: 'produit', label: "Produit / service" }, { id: 'livraison', label: "Livraison" }, { id: 'facturation', label: "Facturation" }, { id: 'autre', label: "Autre" } ] }),
          F('fld_urgence', 'chips', "Urgence", { required: true, choices: [ { id: 'faible', label: "Faible" }, { id: 'moyenne', label: "Moyenne" }, { id: 'elevee', label: "Élevée" } ] }),
          F('fld_description', 'text-long', "Décrivez le problème", { required: true, placeholder: "Le plus précisément possible…", max_chars: 1200, rows: 5 }),
          F('fld_piece', 'url-external', "Photo / pièce jointe (lien)", { placeholder: "Lien Drive / WeTransfer…" }),
        ]),
        S('sec_attente', 'Votre attente', "", [
          F('fld_solution', 'chips', "Solution attendue", { choices: [ { id: 'remboursement', label: "Remboursement" }, { id: 'remplacement', label: "Remplacement" }, { id: 'reparation', label: "Réparation" }, { id: 'explication', label: "Explication" } ] }),
        ]),
      ],
      "Nouvelle réclamation",
    ),
  },

  {
    id: 'fiche-etablissement',
    category: 'relation',
    name: 'Fiche établissement (Concierge)',
    ico: 'globe',
    description: "Fiche prête à importer dans un Smart QR Concierge : offres, FAQ et questions suggérées. Remplissez, publiez, puis importez dans le QR.",
    // Réutilise le gabarit officiel → champs cg_* garantis compatibles
    // avec l'import Concierge (_cgImportFromForm).
    form: buildConciergeFicheGabarit(),
  },

  // ───────── D. MESURE & DÉCISION ─────────
  {
    id: 'nps',
    category: 'mesure',
    name: 'Enquête de satisfaction (NPS)',
    ico: 'sliders',
    description: "Mesurez la recommandation (NPS), la satisfaction globale et recueillez un verbatim — en réponses anonymes.",
    form: FORM(
      { title: 'Enquête de satisfaction', anonymous: true, ttl_days: 180, brand_gradient: G.mesure,
        intro: "Votre avis compte. Ce questionnaire est anonyme et ne prend qu'une minute." },
      [
        S('sec_experience', 'Votre expérience', "", [
          F('fld_nps', 'nps', "Recommanderiez-vous notre service à un proche ?", { required: true, low_label: "Pas du tout probable", high_label: "Extrêmement probable" }),
          F('fld_satisfaction', 'likert', "Globalement, êtes-vous satisfait ?", { required: true }),
          F('fld_aspects', 'cards', "Ce qui vous a plu (plusieurs possibles)", { min: 0, max: null, choices: [
            { id: 'qualite', label: "Qualité", ico: 'sparkles', desc: "" },
            { id: 'delais', label: "Délais", ico: 'history', desc: "" },
            { id: 'accueil', label: "Accueil", ico: 'check', desc: "" },
            { id: 'prix', label: "Rapport qualité/prix", ico: 'package', desc: "" },
          ] }),
        ]),
        S('sec_avis', 'Votre avis', "", [
          F('fld_verbatim', 'text-long', "Un commentaire ?", { placeholder: "Ce qui vous a marqué, ce qu'on pourrait améliorer…", max_chars: 600, rows: 3 }),
          F('fld_recontact', 'yes-no', "Acceptez-vous d'être recontacté ?", { yes_label: "Oui", no_label: "Non" }),
          F('fld_email', 'email', "Votre email", { placeholder: "prenom@exemple.fr",
            visible_if:  { field: 'fld_recontact', op: 'eq', value: 'yes' },
            required_if: { field: 'fld_recontact', op: 'eq', value: 'yes' } }),
        ]),
      ],
      "Nouvelle réponse — satisfaction",
    ),
  },

  {
    id: 'vote',
    category: 'mesure',
    name: 'Vote & priorisation',
    ico: 'check',
    description: "Faites trancher un groupe : classement des 3 priorités, options qui intéressent et niveau d'accord — en anonyme.",
    form: FORM(
      { title: 'Vote & priorisation', anonymous: true, ttl_days: 90, brand_gradient: G.mesure,
        intro: "Aidez-nous à décider. Votre vote est anonyme." },
      [
        S('sec_choix', 'Votre choix', "", [
          F('fld_top3', 'rank-top3', "Classez vos 3 priorités", { required: true, slots: 3, placeholder: "Priorité" }),
          F('fld_options', 'cards', "Options qui vous intéressent (plusieurs possibles)", { min: 1, max: null, choices: [
            { id: 'opt1', label: "Option A", ico: 'sparkles', desc: "Décrivez l'option" },
            { id: 'opt2', label: "Option B", ico: 'package', desc: "Décrivez l'option" },
            { id: 'opt3', label: "Option C", ico: 'globe', desc: "Décrivez l'option" },
          ] }),
          F('fld_accord', 'likert', "À quel point êtes-vous d'accord avec la proposition principale ?", { required: true }),
        ]),
        S('sec_commentaire', 'Commentaire', "", [
          F('fld_commentaire', 'text-long', "Une remarque ?", { placeholder: "Optionnel…", max_chars: 500, rows: 3 }),
        ]),
      ],
      "Nouveau vote",
    ),
  },

  {
    id: 'evenement',
    category: 'mesure',
    name: 'Inscription à un événement',
    ico: 'check-square',
    description: "Inscriptions et accompagnants : sessions, préférences repas et besoins d'accessibilité, avec code d'accès possible.",
    form: FORM(
      { title: "Inscription à l'événement", anonymous: false, ttl_days: 90, brand_gradient: G.mesure,
        intro: "Réservez votre place. Indiquez vos préférences et vos éventuels accompagnants." },
      [
        S('sec_coordonnees', 'Vos coordonnées', "", [
          F('fld_prenom', 'text-short', "Prénom", { required: true, width: '1/2' }),
          F('fld_nom', 'text-short', "Nom", { required: true, width: '1/2' }),
          F('fld_email', 'email', "Email", { required: true }),
          F('fld_tel', 'text-short', "Téléphone", { width: '1/2', placeholder: "06 …" }),
        ]),
        S('sec_participation', 'Votre participation', "", [
          F('fld_session', 'cards', "Sessions / créneaux (plusieurs possibles)", { required: true, min: 1, max: null, choices: [
            { id: 's1', label: "Session 1", ico: 'history', desc: "Date & horaire" },
            { id: 's2', label: "Session 2", ico: 'history', desc: "Date & horaire" },
            { id: 's3', label: "Session 3", ico: 'history', desc: "Date & horaire" },
          ] }),
          F('fld_repas', 'chips', "Préférence repas", { choices: [ { id: 'standard', label: "Standard" }, { id: 'vege', label: "Végétarien" }, { id: 'vegan', label: "Vegan" }, { id: 'sansgluten', label: "Sans gluten" } ] }),
          F('fld_pmr', 'yes-no', "Besoin d'accessibilité PMR ?", { yes_label: "Oui", no_label: "Non" }),
          F('fld_pmr_detail', 'text-short', "Précisez votre besoin", { visible_if: { field: 'fld_pmr', op: 'eq', value: 'yes' } }),
        ]),
        S('sec_accompagnants', 'Accompagnants', "Ajoutez vos accompagnants (optionnel).", [
          F('fld_accompagnants', 'repeater', "Accompagnants", { item_label: 'Accompagnant', add_label: "Ajouter un accompagnant", min: 0, max: 0, fields: [
            F('ra_nom', 'text-short', "Nom"),
            F('ra_age', 'text-short', "Âge"),
          ] }),
        ]),
      ],
      "Nouvelle inscription",
    ),
  },

  {
    id: 'checklist',
    category: 'mesure',
    name: 'Check-list opérationnelle',
    ico: 'check',
    description: "Procédure d'ouverture / fermeture / contrôle : points conformes ou à corriger, anomalies en photo et validation signée.",
    form: FORM(
      { title: 'Check-list opérationnelle', anonymous: false, ttl_days: 180, brand_gradient: G.mesure,
        intro: "Passez chaque point en revue, signalez les anomalies, puis validez." },
      [
        S('sec_infos', 'Informations', "", [
          F('fld_responsable', 'text-short', "Responsable", { required: true, width: '1/2', placeholder: "Prénom Nom" }),
          F('fld_date', 'date', "Date", { required: true, width: '1/2' }),
          F('fld_lieu', 'text-short', "Site / lieu", { placeholder: "Ex : Boutique centre-ville" }),
        ]),
        S('sec_controle', 'Points de contrôle', "Cochez « Conforme » ou « À corriger » pour chaque point.", [
          F('fld_c1', 'yes-no', "Ouverture des locaux", { yes_label: "Conforme", no_label: "À corriger" }),
          F('fld_c2', 'yes-no', "Matériel / équipements vérifiés", { yes_label: "Conforme", no_label: "À corriger" }),
          F('fld_c3', 'yes-no', "Sécurité & issues dégagées", { yes_label: "Conforme", no_label: "À corriger" }),
          F('fld_c4', 'yes-no', "Propreté & rangement", { yes_label: "Conforme", no_label: "À corriger" }),
          F('fld_c5', 'yes-no', "Caisse / stock", { yes_label: "Conforme", no_label: "À corriger" }),
          F('fld_c6', 'yes-no', "Fermeture & alarme", { yes_label: "Conforme", no_label: "À corriger" }),
        ]),
        S('sec_anomalies', 'Anomalies', "Détaillez ce qui est à corriger (optionnel).", [
          F('fld_anomalies', 'repeater', "Anomalies", { item_label: 'Anomalie', add_label: "Ajouter une anomalie", min: 0, max: 0, fields: [
            F('rn_desc', 'text-long', "Description", { placeholder: "Ce qui ne va pas…", max_chars: 400, rows: 2 }),
            F('rn_gravite', 'chips', "Gravité", { choices: [ { id: 'mineure', label: "Mineure" }, { id: 'majeure', label: "Majeure" }, { id: 'bloquante', label: "Bloquante" } ] }),
            F('rn_photo', 'url-external', "Photo (lien)", { placeholder: "Lien…" }),
          ] }),
        ]),
        S('sec_validation', 'Validation', "", [
          F('fld_global', 'yes-no', "Tout est conforme ?", { required: true, yes_label: "Oui, conforme", no_label: "Non" }),
          F('fld_signature', 'signature', "Signature du responsable", { required: true }),
        ]),
      ],
      "Check-list complétée",
    ),
  },

];

// Renvoie une copie profonde du form d'un modèle (pour instanciation
// sans muter la définition partagée).
export function instantiateTemplate(templateId) {
  const t = KEYFORM_TEMPLATES.find(x => x.id === templateId);
  if (!t) return null;
  return JSON.parse(JSON.stringify(t.form));
}
