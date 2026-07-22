/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key-Store Catalog
   Catalogue des applications réelles du Key-Store.
   ─────────────────────────────────────────────────────────────
   Historique : ce fichier contenait des « coquilles vides »
   (MOCK-*) placées pour valider la nouvelle UI plein écran. Elles
   ont été retirées une fois la production des vraies apps lancée —
   le Key-Store n'expose plus que des applications réelles.

   Chaque entrée fournit la taxonomie K-Store (category/subcategory)
   et les métadonnées d'affichage. Le contenu rédactionnel détaillé
   (longDesc, screenshots…) provient du catalogue D1 via _ksMergeApp.
   ═══════════════════════════════════════════════════════════════ */

// ── Catégories du Key-Store ───────────────────────────────────
// Catégories À PLAT (pas de parent) : la sidebar liste directement
// Immobilier / Communication / Productivité. Codes préfixés `KS_` pour
// rester ISOLÉS de la taxonomie legacy du dashboard (IMM/COM/PRD…) — sans
// ça, le catalog D1 écraserait le rangement (cf. _ksNormalizeD1).
// On rouvrira d'autres univers quand des apps seront produites.
export const KSTORE_CATEGORIES = [
    { id: 'KS_CREER',     label: 'Créer' },
    { id: 'KS_ORGANISER', label: 'Organiser' },
    { id: 'KS_DIFFUSER',  label: 'Diffuser' },
    { id: 'KS_INTERAGIR', label: 'Interagir' },
    { id: 'KS_ANALYSER',  label: 'Analyser' },
];

// ── Apps du Key-Store ─────────────────────────────────────────
// Toutes réelles : bouton d'achat actif, référencées par leur id
// NOMEN-K (lien avec pads-data.js / flow Stripe).
export const KSTORE_MOCK_APPS = [
    // ── VEFA DÉPOSÉ le 2026-07-16 (PR #12 chore/remove-vefa) ──────
    //    Les cartes K-Store O-IMM-010 (VEFA Studio) et O-IMM-002
    //    (Annonces Immo) ont été retirées ici le 2026-07-23 : leur
    //    catégorie KS_IMM n'existe plus dans KSTORE_CATEGORIES, elles
    //    flottaient donc « hors catégorie » dans la grille tout en
    //    pointant vers des apps front déjà supprimées (vefa-studio.js /
    //    annonces-immo.js). Les pads O-IMM-* restent published:false
    //    dans pads-data.js (dormants, invisibles). Ne pas ressusciter.

    // ── Communication (KS_COM) + Productivité (KS_PRD) ────────
    // Le rangement réel suit le champ `category` de chaque app (pas l'ordre).
    {
        id: 'A-COM-001',
        category: 'KS_DIFFUSER',
        title: 'Smart Dynamic QR',
        punchline: 'QR codes souverains · sans GAFAM',
        shortDesc: 'Statiques + Dynamiques · stats RGPD · studio design',
        price: 49,
        icon: 'sdqr',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-002',
        category: 'KS_ORGANISER',
        title: 'Brief Prod',
        punchline: 'Le brief print/digital infaillible',
        shortDesc: 'Cahier des charges technique · calculateur d\'échelle pour grands formats',
        price: 49,
        icon: 'kodex',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-003',
        category: 'KS_CREER',
        title: 'Brainstorming',
        punchline: '9 personnalités IA dialoguent pour enrichir votre réflexion',
        shortDesc: 'Atelier de brainstorming créatif · 9 personnalités IA en direct · synthèse + plan d\'actions PDF',
        price: 49,
        icon: 'muse',
        ai_optimized: 'Claude + Gemma 4',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-004',
        category: 'KS_ORGANISER',
        title: 'Key Form',
        punchline: 'Le formulaire intelligent qui collecte sans friction',
        shortDesc: 'Builder de questionnaires · URL partageable · notification mail direction',
        price: 49,
        icon: 'pulsa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-005',
        category: 'KS_CREER',
        title: 'Ghost Writer',
        punchline: 'Vos emails et textes, réécrits en 3 variantes',
        shortDesc: '4 contextes · 5 critères · backend Gemma 4 quasi-gratuit · raccourci global',
        price: 49,
        icon: 'ghostwriter',
        ai_optimized: 'Gemma 4',
        ai_compatible: ['Gemma 4', 'Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    // ── Sprint SA-0 — Smart Agent (jumeau numérique de savoir-faire, plan MAX)
    {
        id: 'O-AGT-001',
        category: 'KS_INTERAGIR',
        title: 'Smart Agent',
        punchline: 'Votre savoir-faire devient un expert numérique',
        shortDesc: 'Coffre de savoir Kortex · réponses ancrées avec sources · « je ne sais pas » plutôt qu\'inventer',
        price: 49,
        icon: 'smart-agent',
        ai_optimized: 'Mistral',
        ai_compatible: ['Mistral', 'Claude'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    // ── Sprint Keynapse — espace de connaissances en bulles (constellation perso) ──
    {
        id: 'O-Keyn-001',
        category: 'KS_ORGANISER',
        title: 'Keynapse',
        punchline: 'Vos idées en bulles vivantes',
        shortDesc: 'Constellation de notes sur canevas infini · zones, liens, photos, croquis, mémos vocaux transcrits, rappels',
        price: 49,
        icon: 'keynapse',
        ai_optimized: 'Whisper',
        ai_compatible: ['Whisper', 'Mistral'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    // ── Social Manager — diffusion multi-réseaux (KS_DIFFUSER) ──
    {
        id: 'O-SOC-001',
        category: 'KS_DIFFUSER',
        title: 'Social Manager',
        punchline: 'Un post, tous vos réseaux, en un clic',
        shortDesc: 'Composez une fois · publiez sur Facebook, Instagram, LinkedIn, Threads, Telegram · file de publication + reprise auto',
        price: 49,
        icon: 'user',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    // ── Sentinel — audit web avec suivi (KS_ANALYSER) ──
    {
        id: 'O-GEO-001',
        category: 'KS_ANALYSER',
        title: 'Sentinel',
        punchline: 'Auditez et surveillez vos sites web',
        shortDesc: 'Disponibilité, performance, SEO, sécurité, présence locale, visibilité IA (GEO) · correctifs clé en main',
        price: 49,
        icon: 'sentinel',
        ai_optimized: 'Mistral',
        ai_compatible: ['Mistral', 'Gemini', 'Claude'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    // ── Apps présentes dans CATALOG_DATA (D1) mais qui manquaient ici ──
    // Ajoutées le 2026-07-23 : sans entrée mock, leur catégorie legacy D1
    // (COM/SECURITE) était jetée par _ksNormalizeD1 → elles flottaient
    // « hors catégorie » dans la grille. Le mock impose la taxonomie KS_ ;
    // titre/longDesc/visuels restent fournis par D1 (prioritaire).
    {
        id: 'O-BRD-001',
        category: 'KS_CREER',
        title: 'Key Brand',
        punchline: 'Votre charte graphique vivante',
        shortDesc: 'Interactive, à jour, partageable d\'un lien · multi-chartes · ZÉRO IA',
        price: 49,
        icon: 'keybrand',
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-DSK-001',
        category: 'KS_ORGANISER',
        title: 'desK',
        punchline: 'Le chemin de fer vivant de votre revue',
        shortDesc: 'Qui livre quoi, quand · casier, relances, digestion e-mail · pré-impression',
        price: 49,
        icon: 'desk',
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-NET-001',
        category: 'KS_INTERAGIR',
        title: 'networK',
        punchline: 'Votre réseau relationnel vivant',
        shortDesc: 'Contacts en carte mentale · journal, relances, anniversaires · anti-CRM',
        price: 49,
        icon: 'network',
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-BOK-001',
        category: 'KS_DIFFUSER',
        title: 'booK',
        punchline: 'Vos flipbooks en un fichier qui s\'ouvre partout',
        shortDesc: 'Export HTML autoporté · bibliothèque · partage lien/QR · sans serveur',
        price: 49,
        icon: 'book',
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-SEC-001',
        category: 'KS_DIFFUSER',
        title: 'Missive',
        punchline: 'Transmettez un secret qui se lit une fois',
        shortDesc: 'Usage unique scellé NFC/QR · chiffrement E2E · serveur aveugle',
        price: 49,
        icon: 'sceau',
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
];

// ── "À la une pour vous" — apps mises en avant (rail du haut) ──
export const KSTORE_FEATURED_IDS = [
    'A-COM-005',  // Ghost Writer (NEW Sprint GW-2) — mis en featured pour visibilité
    'A-COM-002',
    'A-COM-004',
    'A-COM-001',
];

// ── Header promo "À la une" — bandeaux publicitaires du Key-Store ──
// Grand header en carrousel affiché en haut de l'accueil du Key-Store.
// C'est VOTRE espace publicitaire : ajoutez/retirez des slides librement.
//
// Champs d'une slide :
//   eyebrow   : petite étiquette en haut (ex : "Nouveau", "Immobilier")  [option]
//   title     : grand titre du bandeau                                    [option]
//   subtitle  : phrase d'accroche sous le titre                           [option]
//   cta       : libellé du bouton (n'apparaît que si appId est défini)    [option]
//   appId     : id d'une app → clic sur le bandeau ouvre sa fiche         [option]
//   palette   : couleur du dégradé si pas d'image
//               'indigo' | 'violet' | 'blue' | 'amber' | 'emerald'
//   image     : URL d'un visuel publicitaire plein cadre.                 [option]
//               Si renseigné, l'image remplit tout le bandeau (le texte
//               se pose dessus avec un voile pour rester lisible).
//               Laissez '' pour un bandeau "dégradé + texte".
//
// Pour un visuel pub 100 % image : mettez 'image' et laissez title/subtitle vides.
export const KSTORE_PROMOS = [
    {
        id: 'promo-ghostwriter',
        eyebrow: 'Nouveau',
        title: 'Ghost Writer',
        subtitle: 'Vos emails et vos textes, réécrits en 3 variantes — sans quitter Keystone.',
        cta: 'Découvrir',
        appId: 'A-COM-005',
        palette: 'violet',
        image: '',
    },
    {
        id: 'promo-sdqr',
        eyebrow: 'Diffuser',
        title: 'Smart Dynamic QR',
        subtitle: 'Des QR codes souverains, traçables et personnalisés — sans GAFAM.',
        cta: 'Découvrir',
        appId: 'A-COM-001',
        palette: 'amber',
        image: '',
    },
];

// ── Helpers ──
export function getMockApp(id) {
    return KSTORE_MOCK_APPS.find(a => a.id === id) || null;
}
export function getMockAppsByCategory(catId) {
    return KSTORE_MOCK_APPS.filter(a => a.category === catId);
}
export function getMockAppsBySubcategory(subId) {
    return KSTORE_MOCK_APPS.filter(a => a.subcategory === subId);
}
export function getCategoryLabel(catId) {
    for (const c of KSTORE_CATEGORIES) {
        if (c.id === catId) return c.label;
        if (c.sub) {
            const s = c.sub.find(x => x.id === catId);
            if (s) return s.label;
        }
    }
    return catId;
}
export function getCategoryPath(catId, subId) {
    const cat = KSTORE_CATEGORIES.find(c => c.id === catId);
    if (!cat) return '';
    if (subId && cat.sub) {
        const sub = cat.sub.find(s => s.id === subId);
        if (sub) return `${cat.label} / ${sub.label}`;
    }
    return cat.label;
}
