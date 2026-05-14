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
// Seules les catégories réellement peuplées sont exposées dans la
// sidebar. On rouvrira NEWS / FUN / FIN / etc. quand des apps de
// ces univers seront produites.
export const KSTORE_CATEGORIES = [
    {
        id: 'BIZ',
        label: 'Économie & entreprise',
        sub: [
            { id: 'BIZ_IMM', label: 'Immobilier' },
            { id: 'BIZ_COM', label: 'Communication' },
        ],
    },
];

// ── Apps du Key-Store ─────────────────────────────────────────
// Toutes réelles : bouton d'achat actif, référencées par leur id
// NOMEN-K (lien avec pads-data.js / flow Stripe).
export const KSTORE_MOCK_APPS = [
    // ── Économie & entreprise > Immobilier ────────────────────
    {
        id: 'O-IMM-001',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Notices VEFA',
        punchline: 'Notice descriptive conforme RE 2020',
        shortDesc: 'Générez vos notices descriptives en 15 sec',
        price: 49,
        icon: 'vefa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-IMM-009',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Contrat de Réservation VEFA',
        punchline: 'Contrat préliminaire Art. L.261-15 CCH',
        shortDesc: 'PDF prêt notaire en 5 minutes',
        price: 29,
        icon: 'vefa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-IMM-002',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Annonces Multi-Portails',
        punchline: '6 portails en une saisie',
        shortDesc: 'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo',
        price: 29,
        icon: 'multiportails',
        ai_optimized: 'ChatGPT',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-IMM-003',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Emails Acquéreurs',
        punchline: 'Communication chantier personnalisée',
        shortDesc: 'Suivi chantier rassurant en quelques secondes',
        price: 29,
        icon: 'mail',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-ANL-001',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'CR Chantier',
        punchline: 'Notes terrain → CR professionnel',
        shortDesc: 'Vos notes brutes structurées en compte-rendu',
        price: 49,
        icon: 'site',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-ANL-002',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Analyste Foncier',
        punchline: 'Dossier foncier complet en 5 minutes',
        shortDesc: 'Faisabilité, potentiel constructible et risques',
        price: 49,
        icon: 'foncier',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-ADM-001',
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Objections Acquéreurs',
        punchline: '3 réponses graduées par objection',
        shortDesc: 'Réponses calibrées : prix, délais, charges, emplacement',
        price: 39,
        icon: 'chat',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },

    // ── Économie & entreprise > Communication ─────────────────
    {
        id: 'O-MKT-001',
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Posts Réseaux Sociaux',
        punchline: 'Facebook · Instagram · LinkedIn',
        shortDesc: 'Posts engageants adaptés à chaque plateforme',
        price: 29,
        icon: 'social',
        ai_optimized: 'Gemini',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'O-MKT-002',
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Brief Photo / 3D',
        punchline: 'Brief créatif professionnel en 2 minutes',
        shortDesc: 'Briefs détaillés pour vos prestataires photo et 3D',
        price: 29,
        icon: 'brief',
        ai_optimized: 'ChatGPT',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-001',
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Sovereign Dynamic QR',
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
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Kodex',
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
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Muse',
        punchline: 'La planche d\'ambiance pour votre studio 3D',
        shortDesc: 'Une planche moodboard professionnelle en une seule génération · 6 vignettes cohérentes',
        price: 49,
        icon: 'muse',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-004',
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Pulsa',
        punchline: 'Le formulaire intelligent qui collecte sans friction',
        shortDesc: 'Builder de questionnaires · URL partageable · notification mail direction',
        price: 49,
        icon: 'pulsa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini', 'Grok', 'Perplexity', 'Llama'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
];

// ── "À la une pour vous" — apps mises en avant (rail du haut) ──
export const KSTORE_FEATURED_IDS = [
    'O-IMM-001',
    'A-COM-002',
    'A-COM-004',
    'A-COM-001',
    'O-IMM-002',
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
