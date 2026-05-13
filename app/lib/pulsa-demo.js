/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PULSA · Formulaire démo VEFA
   ─────────────────────────────────────────────────────────────
   Scénario complet de qualification d'un prospect VEFA pour le
   programme « Les Jardins du Mourillon » (cohérent avec la démo
   Prométhée existante). Utilise les 16 types de champs + toutes
   les features Pulsa (visible_if, required_if, compute_from,
   pré-remplissage URL, code d'accès, champs côte à côte, signature,
   image picker, NPS, Likert, slider, social-links, etc.).

   Cas d'usage : un commercial Prométhée envoie ce lien à un
   prospect après une première visite. Le prospect remplit pour
   formaliser son projet d'achat. La signature en bas vaut accord
   de principe non engageant. Les couleurs et le ton sont
   « Apple Premium nuit ».
   ═══════════════════════════════════════════════════════════════ */

export const DEMO_VEFA_FORM = {
  meta: {
    title: "Dossier d'intérêt — Les Jardins du Mourillon",
    slug: "jardins-mourillon",
    intro:
      "Merci de prendre quelques minutes pour formaliser votre projet. Vos réponses nous permettront de préparer une proposition sur-mesure pour votre prochain rendez-vous.\n\nDurée estimée : 6 minutes. Vos réponses sont confidentielles et conservées 30 jours maximum.",
    logo_data_url: null,
    logo_url: null,
    brand_color: "#0a2741",
    brand_accent: "#c9b48a",
    anonymous: false,
    ttl_days: 30,
    // Pas de code d'accès : la démo doit être accessible immédiatement
    // en ligne pour qu'on puisse partager le lien et tester sans friction.
    access_code: null,
  },
  sections: [
    // ───────────────────────────────────────────────────────────
    {
      id: "sec_identite",
      title: "Identité & contact",
      subtitle: "Pour vous recontacter et préparer votre dossier",
      fields: [
        {
          id: "fld_prenom",
          type: "text-short",
          label: "Prénom",
          help: "",
          required: true,
          width: "1/2",
          options: { placeholder: "Marie", max_chars: 60 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_nom",
          type: "text-short",
          label: "Nom",
          help: "",
          required: true,
          width: "1/2",
          options: { placeholder: "Durand", max_chars: 60 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_email",
          type: "email",
          label: "Email",
          help: "",
          required: true,
          width: "1/2",
          options: { placeholder: "marie.durand@exemple.fr" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_telephone",
          type: "text-short",
          label: "Téléphone",
          help: "",
          required: true,
          width: "1/2",
          options: { placeholder: "06 12 34 56 78", max_chars: 30 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_site_perso",
          type: "website",
          label: "Site web professionnel (optionnel)",
          help: "Utile si vous êtes profession libérale ou indépendant",
          required: false,
          width: "full",
          options: { placeholder: "https://votre-site.fr" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_reseaux",
          type: "social-links",
          label: "Réseaux professionnels (optionnel)",
          help: "",
          required: false,
          width: "full",
          options: {
            networks: [
              { id: "linkedin",  label: "LinkedIn",  placeholder: "URL du profil",     enabled: true },
              { id: "instagram", label: "Instagram", placeholder: "@compte ou URL",    enabled: false },
              { id: "facebook",  label: "Facebook",  placeholder: "URL du profil",     enabled: false },
              { id: "x",         label: "X (Twitter)", placeholder: "@compte ou URL",  enabled: false },
              { id: "tiktok",    label: "TikTok",    placeholder: "@compte ou URL",    enabled: false },
              { id: "youtube",   label: "YouTube",   placeholder: "URL de la chaîne",  enabled: false },
              { id: "behance",   label: "Behance",   placeholder: "URL du portfolio",  enabled: false },
              { id: "pinterest", label: "Pinterest", placeholder: "URL du compte",     enabled: false },
              { id: "vimeo",     label: "Vimeo",     placeholder: "URL de la chaîne",  enabled: false },
            ],
          },
          visible_if: null, required_if: null, compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_projet",
      title: "Votre projet",
      subtitle: "Aidez-nous à cerner le bien qui vous correspondra",
      fields: [
        {
          id: "fld_typologie",
          type: "chips",
          label: "Type de bien recherché",
          help: "",
          required: true,
          width: "full",
          options: {
            choices: [
              { id: "t2", label: "T2" },
              { id: "t3", label: "T3" },
              { id: "t4", label: "T4" },
              { id: "t5", label: "T5 ou plus" },
              { id: "indif", label: "Indifférent" },
            ],
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_ambiance",
          type: "cards",
          label: "Ambiances qui vous correspondent (plusieurs possibles)",
          help: "",
          required: true,
          width: "full",
          options: {
            choices: [
              { id: "minimal",  label: "Minimaliste",     ico: "sparkles", desc: "Lignes épurées, lumière naturelle" },
              { id: "familial", label: "Familial",        ico: "sparkles", desc: "Espaces de vie spacieux, sécurité" },
              { id: "vue_mer",  label: "Vue mer",         ico: "sparkles", desc: "Ouverture maritime, étages élevés" },
              { id: "centre",   label: "Centre-ville",    ico: "sparkles", desc: "À pied des commerces et services" },
            ],
            min: 1, max: null,
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_vue",
          type: "image-picker",
          label: "Quelle ambiance visuelle vous attire le plus ?",
          help: "Sélectionnez l'image qui se rapproche le plus de l'environnement souhaité",
          required: false,
          width: "full",
          options: {
            choices: [
              { id: "img_mer",    label: "Vue mer & horizon",   image_url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop" },
              { id: "img_parc",   label: "Parc & verdure",      image_url: "https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&h=300&fit=crop" },
              { id: "img_ville",  label: "Cœur de ville",       image_url: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&h=300&fit=crop" },
              { id: "img_jardin", label: "Jardin & terrasse",   image_url: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400&h=300&fit=crop" },
            ],
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_deja_visite",
          type: "yes-no",
          label: "Avez-vous déjà visité notre programme ?",
          help: "",
          required: true,
          width: "1/2",
          options: { yes_label: "Oui", no_label: "Pas encore" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_date_visite",
          type: "date",
          label: "Date de votre visite",
          help: "Pour retrouver votre dossier rapidement",
          required: true,
          width: "1/2",
          options: { min: null, max: null },
          // BRANCHING : visible uniquement si la visite a eu lieu
          visible_if: { field: "fld_deja_visite", op: "eq", value: "yes" },
          required_if: null,
          compute_from: null,
        },
        {
          id: "fld_finalite",
          type: "chips",
          label: "C'est pour vous…",
          help: "",
          required: true,
          width: "full",
          options: {
            choices: [
              { id: "principale", label: "Résidence principale" },
              { id: "secondaire", label: "Résidence secondaire" },
              { id: "invest",     label: "Investissement locatif" },
            ],
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_fiscalite",
          type: "chips",
          label: "Optique fiscale visée",
          help: "Notre conseiller fiscal vous accompagnera",
          required: false,
          width: "full",
          options: {
            choices: [
              { id: "pinel", label: "Pinel" },
              { id: "lmnp",  label: "LMNP / LMP" },
              { id: "nue",   label: "Location nue" },
              { id: "indif", label: "À conseiller" },
            ],
          },
          // BRANCHING + REQUIRED_IF : visible et obligatoire uniquement
          // si c'est un investissement locatif
          visible_if:  { field: "fld_finalite", op: "eq", value: "invest" },
          required_if: { field: "fld_finalite", op: "eq", value: "invest" },
          compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_budget",
      title: "Budget & financement",
      subtitle: "Une estimation, même approximative, suffit",
      fields: [
        {
          id: "fld_apport",
          type: "amount",
          label: "Apport personnel",
          help: "",
          required: true,
          width: "1/2",
          options: { currency: "EUR", min: 0, max: null, decimals: 0 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_emprunt",
          type: "amount",
          label: "Capacité d'emprunt totale",
          help: "Sur la durée du crédit",
          required: true,
          width: "1/2",
          options: { currency: "EUR", min: 0, max: null, decimals: 0 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_frais_notaire",
          type: "amount",
          label: "Frais de notaire estimés",
          help: "Réduits en VEFA (~2,5% du prix de vente)",
          required: false,
          width: "1/2",
          options: { currency: "EUR", min: 0, max: null, decimals: 0 },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_budget_total",
          type: "amount",
          label: "Budget total disponible",
          help: "Calculé automatiquement à partir des champs précédents",
          required: false,
          width: "1/2",
          options: { currency: "EUR", min: 0, max: null, decimals: 0 },
          visible_if: null,
          required_if: null,
          // COMPUTE_FROM : somme automatique des 3 champs amount précédents
          compute_from: { fields: ["fld_apport", "fld_emprunt", "fld_frais_notaire"], op: "sum" },
        },
        {
          id: "fld_accord_banque",
          type: "yes-no",
          label: "Avez-vous déjà un accord de principe bancaire ?",
          help: "",
          required: true,
          width: "full",
          options: { yes_label: "Oui", no_label: "Pas encore" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_banque_validite",
          type: "date",
          label: "Date de validité de l'accord",
          help: "Pour anticiper le renouvellement",
          required: false,
          width: "1/2",
          options: { min: null, max: null },
          // BRANCHING + REQUIRED_IF : pertinent uniquement si accord obtenu
          visible_if:  { field: "fld_accord_banque", op: "eq", value: "yes" },
          required_if: { field: "fld_accord_banque", op: "eq", value: "yes" },
          compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_priorites",
      title: "Priorités & préférences",
      subtitle: "Pour personnaliser nos prochains échanges",
      fields: [
        {
          id: "fld_horizon",
          type: "slider",
          label: "Horizon d'emménagement souhaité (en mois)",
          help: "",
          required: true,
          width: "full",
          options: { min: 3, max: 36, step: 3, unit: "mois", low_label: "Rapide", high_label: "Patient" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_priorites",
          type: "rank-top3",
          label: "Classez vos 3 critères prioritaires",
          help: "Surface, localisation, prix, vue, étage, parking, balcon, exposition…",
          required: true,
          width: "full",
          options: { slots: 3, placeholder: "Critère" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_emplacement_flex",
          type: "likert",
          label: "Êtes-vous prêt à transiger sur l'emplacement ?",
          help: "Le quartier exact peut-il varier ?",
          required: true,
          width: "full",
          options: {
            choices: [
              { id: "lk1", label: "Absolument non négociable" },
              { id: "lk2", label: "Plutôt pas" },
              { id: "lk3", label: "Indifférent" },
              { id: "lk4", label: "Plutôt oui" },
              { id: "lk5", label: "Totalement flexible" },
            ],
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_finitions",
          type: "slider",
          label: "Niveau de finitions attendu",
          help: "1 = standard du marché, 10 = prestations haut de gamme",
          required: false,
          width: "full",
          options: { min: 1, max: 10, step: 1, unit: "/10", low_label: "Standard", high_label: "Premium" },
          visible_if: null, required_if: null, compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_pieces",
      title: "Pièces & note personnelle",
      subtitle: "Pour gagner du temps lors du rendez-vous",
      fields: [
        {
          id: "fld_pieces_link",
          type: "url-external",
          label: "Lien vers vos justificatifs (bulletins de salaire, avis d'imposition…)",
          help: "Si vous les avez déjà préparés. Sinon on les récupère au prochain RDV.",
          required: false,
          width: "full",
          options: {
            placeholder: "https://wetransfer.com/…",
            providers_hint: "WeTransfer · Google Drive · Dropbox · iCloud",
          },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_note_libre",
          type: "text-long",
          label: "Questions, contraintes, demandes spécifiques",
          help: "Vous avez carte blanche. Ce qui n'est pas dit ne peut pas être anticipé.",
          required: false,
          width: "full",
          options: { placeholder: "Ce que vous souhaitez vraiment qu'on retienne…", max_chars: 1500, rows: 6, strict: true },
          // REQUIRED_IF : devient obligatoire si la visite a eu lieu
          // (= le prospect a forcément vu des choses à commenter)
          required_if: { field: "fld_deja_visite", op: "eq", value: "yes" },
          visible_if: null,
          compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_feedback",
      title: "Premier contact commercial",
      subtitle: "Votre retour nous fait progresser",
      fields: [
        {
          id: "fld_nps",
          type: "nps",
          label: "Sur une échelle de 0 à 10, recommanderiez-vous notre interlocuteur commercial à un proche ?",
          help: "Anonyme et sans incidence sur votre dossier",
          required: true,
          width: "full",
          options: { low_label: "Pas du tout probable", high_label: "Extrêmement probable" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_commentaire_nps",
          type: "text-long",
          label: "Commentaire libre (optionnel)",
          help: "Une réussite à souligner ou un point à améliorer",
          required: false,
          width: "full",
          options: { placeholder: "Ce qui pourrait nous faire mieux la prochaine fois…", max_chars: 500, rows: 3, strict: true },
          visible_if: null, required_if: null, compute_from: null,
        },
      ],
      visible_if: null,
    },

    // ───────────────────────────────────────────────────────────
    {
      id: "sec_engagement",
      title: "Engagement & signature",
      subtitle: "Pas d'engagement financier — simple intention",
      fields: [
        {
          id: "fld_autorisation",
          type: "yes-no",
          label: "J'autorise Prométhée Immobilier à me recontacter au sujet de ce dossier",
          help: "Vous pourrez retirer ce consentement à tout moment",
          required: true,
          width: "full",
          options: { yes_label: "Oui, j'autorise", no_label: "Non" },
          visible_if: null, required_if: null, compute_from: null,
        },
        {
          id: "fld_signature",
          type: "signature",
          label: "Signature de validation",
          help: "Votre signature vaut accord de principe sans engagement financier ni juridique",
          required: true,
          width: "full",
          options: { hint: "Signez avec votre doigt (mobile) ou la souris (ordinateur)" },
          visible_if: null, required_if: null, compute_from: null,
        },
      ],
      visible_if: null,
    },
  ],
  delivery: {
    // Liste vide volontaire : chaque testeur ajoute SA propre adresse mail
    // dans l'étape Livraison avant de publier. Plus parlant pour la démo
    // que des adresses Prométhée pré-câblées.
    recipients: [],
    notification_subject: "Nouveau dossier d'intérêt — Les Jardins du Mourillon",
  },
  output: {
    status: "draft",
    published_url: null,
    last_response_at: null,
  },
};
