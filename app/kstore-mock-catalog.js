/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — Key-Store Mock Catalog
   Catalogue de coquilles vides pour valider la nouvelle UI plein écran.
   À supprimer / remplacer quand les vraies apps seront produites.
   La seule entrée RÉELLE est Notice VEFA (id: O-IMM-001) — toutes les
   autres sont des placeholders avec bouton "Bientôt disponible".
   ═══════════════════════════════════════════════════════════════ */

// ── Catégories de la nouvelle taxonomie (inspirées Mac App Store) ──
export const KSTORE_CATEGORIES = [
    { id: 'NEWS',     label: 'Actualités' },
    { id: 'FUN',      label: 'Divertissement' },
    {
        id: 'BIZ',
        label: 'Économie & entreprise',
        sub: [
            { id: 'BIZ_IMM', label: 'Immobilier' },
            { id: 'BIZ_RST', label: 'Restauration' },
            { id: 'BIZ_LSR', label: 'Loisirs' },
            { id: 'BIZ_COM', label: 'Communication' },
        ],
    },
    { id: 'FIN',      label: 'Finance' },
    { id: 'GFX',      label: 'Graphisme & Design' },
    { id: 'MED',      label: 'Médecine' },
    { id: 'MUS',      label: 'Musique' },
    { id: 'PRD',      label: 'Productivité' },
    { id: 'SOC',      label: 'Réseaux sociaux' },
    { id: 'LIF',      label: 'Style de vie' },
    { id: 'UTL',      label: 'Utilitaires' },
];

// ── Apps mockées : une coquille vide par catégorie/sous-catégorie ──
// Notice VEFA reste la seule réelle (référencée par son id O-IMM-001
// pour pouvoir être achetée via le flow Stripe existant).
export const KSTORE_MOCK_APPS = [
    // Économie & entreprise > Immobilier
    {
        id: 'O-IMM-001',                      // ← réelle, référence pads-data.js
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Notices VEFA',
        punchline: 'Notice descriptive conforme RE 2020',
        shortDesc: 'Générez vos notices descriptives en 15 sec',
        price: 49,
        icon: 'vefa',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,                           // ← bouton acheter actif
    },
    {
        id: 'O-IMM-009',                      // ← Sprint 4 — réelle, pad A9
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
        id: 'O-IMM-002',                      // ← Sprint 5 — réelle, pad A2 (Multi-Portails)
        category: 'BIZ', subcategory: 'BIZ_IMM',
        title: 'Annonces Multi-Portails',
        punchline: '6 portails en une saisie',
        shortDesc: 'SeLoger · LeBonCoin · Bien\'ici · Logic-Immo · Figaro Immo',
        price: 29,
        icon: 'ad',
        ai_optimized: 'ChatGPT',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },
    {
        id: 'A-COM-001',                      // ← Sprint SDQR-1 — réel, artefact fullscreen
        category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Sovereign Dynamic QR',
        punchline: 'QR codes souverains · sans GAFAM',
        shortDesc: 'Statiques + Dynamiques · stats RGPD · studio design',
        price: 49,
        icon: 'zap',
        ai_optimized: 'Claude',
        ai_compatible: ['Claude', 'GPT 5', 'Mistral', 'Gemini'],
        copyright: '© 2026-2027 Protein Studio',
        real: true,
    },

    // Coquilles vides — une par catégorie principale + sous-tags BIZ
    {
        id: 'MOCK-BIZ-RST', category: 'BIZ', subcategory: 'BIZ_RST',
        title: 'Nom d\'une App Restauration', punchline: 'Punchline App',
        shortDesc: 'Brève description de l\'App', price: 0,
    },
    {
        id: 'MOCK-BIZ-LSR', category: 'BIZ', subcategory: 'BIZ_LSR',
        title: 'Nom d\'une App Loisirs', punchline: 'Punchline App',
        shortDesc: 'Brève description de l\'App', price: 0,
    },
    {
        id: 'MOCK-BIZ-COM', category: 'BIZ', subcategory: 'BIZ_COM',
        title: 'Nom d\'une App Communication', punchline: 'Punchline App',
        shortDesc: 'Brève description de l\'App', price: 0,
    },

    { id: 'MOCK-NEWS-001', category: 'NEWS', title: 'Nom d\'une App Actu',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-FUN-001',  category: 'FUN',  title: 'Nom d\'une App Divertissement',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-FIN-001',  category: 'FIN',  title: 'Nom d\'une App Finance',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-GFX-001',  category: 'GFX',  title: 'Nom d\'une App Design',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-MED-001',  category: 'MED',  title: 'Nom d\'une App Médecine',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-MUS-001',  category: 'MUS',  title: 'Nom d\'une App Musique',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-PRD-001',  category: 'PRD',  title: 'Nom d\'une App Productivité',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-SOC-001',  category: 'SOC',  title: 'Nom d\'une App Réseaux sociaux',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-LIF-001',  category: 'LIF',  title: 'Nom d\'une App Style de vie',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
    { id: 'MOCK-UTL-001',  category: 'UTL',  title: 'Nom d\'une App Utilitaire',
      punchline: 'Punchline App', shortDesc: 'Brève description de l\'App', price: 0 },
];

// ── "À la une pour vous" — 5 apps mises en avant (rail du haut) ──
export const KSTORE_FEATURED_IDS = [
    'O-IMM-001',
    'MOCK-BIZ-COM',
    'MOCK-PRD-001',
    'MOCK-GFX-001',
    'MOCK-FIN-001',
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
