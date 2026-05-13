/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — PULSA · Catalogue des types de champ (V1)
   Sprint Pulsa-2A.

   10 types atomiques essentiels qui couvrent 90% des cas
   (diagnostics, onboarding, candidatures, qualifications).

   Stratégie produit :
   - Pas de stockage de binaires : les fichiers HD passent par
     un champ "url-external" (lien WeTransfer / Drive / Vimeo).
   - Texte long avec compteur STRICT (bloquant) → évite les
     romans inutilisables dans les formulaires courts.
   - Schéma JSON conçu pour supporter la logique conditionnelle
     V2 (visible_if, required_if, compute_from) sans refacto.

   La V2 enrichira ce catalogue avec : signature manuscrite, NPS,
   Likert, étoiles, slider, carte interactive, image picker,
   matrice, audio note, color picker, plage de dates, heure.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Catalogue des types de champ disponibles dans le builder.
 * Chaque type définit son label utilisateur, son icône, son
 * groupe (pour le menu de sélection) et ses options par défaut.
 */
export const FIELD_TYPES = {
  'text-short': {
    label: 'Texte court',
    sub: 'Une ligne de saisie libre',
    ico: 'edit',
    group: 'text',
    defaults: {
      placeholder: 'Votre réponse',
      max_chars: 120,
    },
  },
  'text-long': {
    label: 'Texte long avec compteur',
    sub: 'Paragraphe avec limite de signes stricte',
    ico: 'file-text',
    group: 'text',
    defaults: {
      placeholder: 'Votre réponse détaillée',
      max_chars: 500,
      rows: 4,
      strict: true,
    },
  },
  'email': {
    label: 'Email',
    sub: 'Adresse email validée',
    ico: 'edit',
    group: 'contact',
    defaults: {
      placeholder: 'prenom.nom@exemple.fr',
    },
  },
  'website': {
    label: 'Site web',
    sub: 'URL d\'un site personnel ou professionnel (auto-format https://)',
    ico: 'globe',
    group: 'contact',
    defaults: {
      placeholder: 'https://votre-site.com',
    },
  },
  'social-links': {
    label: 'Réseaux sociaux',
    sub: 'Sélection de comptes (Instagram, LinkedIn, X, TikTok…)',
    ico: 'globe',
    group: 'contact',
    defaults: {
      networks: [
        { id: 'instagram', label: 'Instagram', placeholder: '@compte ou URL',     enabled: true },
        { id: 'facebook',  label: 'Facebook',  placeholder: 'URL du profil',      enabled: true },
        { id: 'linkedin',  label: 'LinkedIn',  placeholder: 'URL du profil',      enabled: true },
        { id: 'x',         label: 'X (Twitter)', placeholder: '@compte ou URL',   enabled: true },
        { id: 'tiktok',    label: 'TikTok',    placeholder: '@compte ou URL',     enabled: false },
        { id: 'youtube',   label: 'YouTube',   placeholder: 'URL de la chaîne',   enabled: false },
        { id: 'behance',   label: 'Behance',   placeholder: 'URL du portfolio',   enabled: false },
        { id: 'pinterest', label: 'Pinterest', placeholder: 'URL du compte',      enabled: false },
        { id: 'vimeo',     label: 'Vimeo',     placeholder: 'URL de la chaîne',   enabled: false },
      ],
    },
  },
  'chips': {
    label: 'Chips (choix unique)',
    sub: 'Boutons compacts, un seul choix',
    ico: 'check-square',
    group: 'choice',
    defaults: {
      choices: [
        { id: 'opt1', label: 'Option 1' },
        { id: 'opt2', label: 'Option 2' },
      ],
    },
  },
  'cards': {
    label: 'Tool cards (choix multiple)',
    sub: 'Cartes avec icône, plusieurs choix possibles',
    ico: 'package',
    group: 'choice',
    defaults: {
      choices: [
        { id: 'c1', label: 'Choix 1', ico: 'sparkles', desc: 'Description courte' },
        { id: 'c2', label: 'Choix 2', ico: 'palette',  desc: 'Description courte' },
      ],
      min: 1,
      max: null,
    },
  },
  'yes-no': {
    label: 'Oui / Non',
    sub: 'Choix binaire visuel',
    ico: 'check',
    group: 'choice',
    defaults: {
      yes_label: 'Oui',
      no_label: 'Non',
    },
  },
  'rank-top3': {
    label: 'Classement top 3',
    sub: 'Le répondant ordonne ses 3 priorités',
    ico: 'sliders',
    group: 'choice',
    defaults: {
      slots: 3,
      placeholder: 'Priorité',
    },
  },
  'date': {
    label: 'Date',
    sub: 'Sélecteur de date unique',
    ico: 'history',
    group: 'data',
    defaults: {
      min: null,
      max: null,
    },
  },
  'amount': {
    label: 'Montant',
    sub: 'Valeur monétaire avec devise',
    ico: 'sliders',
    group: 'data',
    defaults: {
      currency: 'EUR',
      min: 0,
      max: null,
      decimals: 2,
    },
  },
  'url-external': {
    label: 'Lien externe (fichier HD)',
    sub: 'URL WeTransfer / Drive / Vimeo — pas d\'upload serveur',
    ico: 'globe',
    group: 'media',
    defaults: {
      placeholder: 'https://wetransfer.com/…',
      providers_hint: 'WeTransfer · Google Drive · Dropbox · Vimeo · YouTube',
    },
  },
};

/**
 * Groupes pour structurer le menu de sélection de type.
 */
export const FIELD_GROUPS = [
  { id: 'text',    label: 'Texte' },
  { id: 'choice',  label: 'Choix' },
  { id: 'contact', label: 'Contact' },
  { id: 'data',    label: 'Données structurées' },
  { id: 'media',   label: 'Médias (lien externe)' },
];

/**
 * Identifiants courts uniques (sans dépendance UUID).
 * Préfixé pour distinguer sections (sec_) et champs (fld_).
 */
let _idCounter = 0;
function _uid(prefix) {
  _idCounter += 1;
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${t}${r}${_idCounter}`;
}

/**
 * Crée un nouveau champ à partir d'un type du catalogue.
 * Le schéma inclut les emplacements de logique conditionnelle
 * (visible_if, required_if, compute_from) qui resteront `null`
 * jusqu'à la V2 du builder.
 */
/**
 * Largeurs disponibles pour un champ (cycle au clic dans le builder).
 * Ordre = ordre du cycle. "full" = pleine largeur, autres = fractions.
 */
export const FIELD_WIDTHS = ['full', '3/4', '1/2', '1/4'];

export function newField(type) {
  const def = FIELD_TYPES[type];
  if (!def) throw new Error(`[pulsa-types] Type inconnu : ${type}`);
  return {
    id: _uid('fld'),
    type,
    label: def.label,
    help: '',
    required: false,
    width: 'full',
    options: structuredClone(def.defaults),
    // Hooks pour la logique conditionnelle V2 (P2B)
    visible_if:   null,
    required_if:  null,
    compute_from: null,
  };
}

/**
 * Crée une nouvelle section vide.
 */
export function newSection(title = 'Nouvelle section') {
  return {
    id: _uid('sec'),
    title,
    subtitle: '',
    fields: [],
    // Hook pour V2 : section conditionnelle (apparaît selon réponse précédente)
    visible_if: null,
  };
}

/**
 * Squelette par défaut d'un formulaire Pulsa.
 */
export function newForm() {
  return {
    meta: {
      title: '',
      slug: '',
      logo_url: null,
      brand_color: '#0a2741',
      brand_accent: '#c9b48a',
      anonymous: true,
      intro: '',
      ttl_days: 90,
    },
    sections: [],
    delivery: {
      recipients: [],
      notification_subject: '',
    },
    output: {
      status: 'draft',
      published_url: null,
      last_response_at: null,
    },
  };
}
