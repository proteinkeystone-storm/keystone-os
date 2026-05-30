// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · concierge (VEFA Phase 1)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/concierge.js.
//
// Le bloc de connaissance Concierge est NESTÉ (programme{} +
// configurations[] + branding{} + faq + contact…) : il ne se mappe pas
// sur le master-renderer plat. L'éditeur dédié (programme / configs
// répéteur / branding couleurs+logo) est construit au Sprint 4 dans
// app/sdqr.js. Ici on fournit le contrat (validate / summary symétriques)
// + fields:[] tant que l'éditeur custom n'est pas branché.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:            'concierge',
  label:         'Concierge immobilier (VEFA)',
  description:   'QR concierge VEFA white-label : accueil + cartes de comparaison déterministes + chat live qui répond depuis un bloc validé. 1 QR = 1 programme complet.',
  icon:          '🛎️',
  tier_required: 'pro',

  // Éditeur nesté dédié construit au Sprint 4 (cf. en-tête).
  fields: [],

  validate(template_data) {
    const errors = [];
    const d    = template_data || {};
    const prog = d.programme || {};
    if (!prog.nom || !String(prog.nom).trim()) {
      errors.push('Le nom du programme est obligatoire.');
    }
    if (!Array.isArray(d.configurations) || d.configurations.length === 0) {
      errors.push('Au moins une configuration est obligatoire.');
    } else {
      d.configurations.forEach((c, i) => {
        if (!c || !c.reference || !String(c.reference).trim()) {
          errors.push(`Configuration #${i + 1} : référence manquante.`);
        }
        if (c && c.statut && !['disponible', 'optionne', 'vendu'].includes(c.statut)) {
          errors.push(`Configuration « ${(c && c.reference) || (i + 1)} » : statut invalide (disponible | optionne | vendu).`);
        }
      });
    }
    const b = d.branding || {};
    if (!b.nom_agence || !String(b.nom_agence).trim()) {
      errors.push('Le nom de l\'agence (branding) est obligatoire.');
    }
    return errors;
  },

  summary(template_data) {
    const d    = template_data || {};
    const prog = d.programme || {};
    const nom  = (prog.nom || 'Programme').toString().trim();
    const n    = Array.isArray(d.configurations) ? d.configurations.length : 0;
    return `Concierge « ${nom} » — ${n} configuration${n > 1 ? 's' : ''}`;
  },
};

export default TEMPLATE;
