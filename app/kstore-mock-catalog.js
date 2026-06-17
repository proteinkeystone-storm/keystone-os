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
    { id: 'KS_IMM', label: 'Immobilier' },
    { id: 'KS_COM', label: 'Communication' },
    { id: 'KS_PRD', label: 'Productivité' },
];

// ── Apps du Key-Store ─────────────────────────────────────────
// Toutes réelles : bouton d'achat actif, référencées par leur id
// NOMEN-K (lien avec pads-data.js / flow Stripe).
export const KSTORE_MOCK_APPS = [
    // ── Immobilier (KS_IMM) ───────────────────────────────────
    // ── O-IMM-001 (Notices VEFA) et O-IMM-009 (Contrat VEFA) retirés
    //    du K-Store le 2026-05-22 : remplacés par VEFA Studio (O-IMM-010)
    //    qui fusionne les deux livrables en un seul outil. Les anciens
    //    pads restent dans pads-data.js pour les utilisateurs qui les
    //    ont déjà achetés, et VEFA Studio migre leurs brouillons.
    {
        id: 'O-IMM-010',
        category: 'KS_IMM',
        title: 'VEFA Studio',
        punchline: 'Notice + Contrat — un seul lot, deux livrables',
        shortDesc: 'Hero à onglets · saisie Programme partagée · auto-calculs HT/TTC',
        price: 49,
        icon: 'vefa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-IMM-002',
        category: 'KS_IMM',
        title: 'Annonces Immo',
        punchline: '6 portails en une saisie',
        shortDesc: 'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo',
        price: 29,
        icon: 'multiportails',
        ai_optimized: 'ChatGPT',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },

    // ── Communication (KS_COM) + Productivité (KS_PRD) ────────
    // Le rangement réel suit le champ `category` de chaque app (pas l'ordre).
    {
        id: 'A-COM-001',
        category: 'KS_COM',
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
        category: 'KS_COM',
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
        category: 'KS_PRD',
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
        category: 'KS_COM',
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
        category: 'KS_PRD',
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
        category: 'KS_PRD',
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
        category: 'KS_PRD',
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
];

// ── "À la une pour vous" — apps mises en avant (rail du haut) ──
export const KSTORE_FEATURED_IDS = [
    'A-COM-005',  // Ghost Writer (NEW Sprint GW-2) — mis en featured pour visibilité
    'O-IMM-010',  // VEFA Studio — remplace O-IMM-001 + O-IMM-009
    'A-COM-002',
    'A-COM-004',
    'A-COM-001',
    'O-IMM-002',
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
        id: 'promo-vefa',
        eyebrow: 'Immobilier',
        title: 'VEFA Studio',
        subtitle: 'Notice descriptive + contrat de réservation : un seul outil, deux livrables.',
        cta: 'En savoir plus',
        appId: 'O-IMM-010',
        palette: 'blue',
        image: '',
    },
    {
        id: 'promo-sdqr',
        eyebrow: 'Communication',
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
