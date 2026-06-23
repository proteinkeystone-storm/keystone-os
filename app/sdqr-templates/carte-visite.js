// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · carte-visite
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/carte-visite.js.
// Carte de visite en page (link-in-bio), 5 designs. Apparaît sous « Contact »
// À CÔTÉ de la vCard native (qui, elle, enregistre direct dans les Contacts).
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'carte-visite',
  label:           'Carte de visite',
  description:     'Carte de visite en page : photo, nom, fonction, boutons Appeler / E-mail / Site + coordonnées. 5 designs au choix. (La vCard native, elle, enregistre direct dans les Contacts.)',
  icon:            '🪪',
  tier_required:   'pro',
  noDestination:   true,   // page terminale : aucune redirection après (cf. sdqr.js)

  fields: [
    { id: 'layout', type: 'select', label: 'Design de la carte', default: '1', span: 'full',
      options: [
        { value: '1', label: 'Design 1 — bandeau bleu + photo' },
        { value: '2', label: 'Design 2 — vague + grande photo' },
        { value: '3', label: 'Design 3 — carte + photo médaillon' },
        { value: '4', label: 'Design 4 — photo en haut + carte' },
        { value: '5', label: 'Design 5 — photo plein cadre + boutons' },
      ],
    },
    { id: 'photo_url',   type: 'image',    label: 'Photo', maxBytes: 55000, maxDim: 900, span: 'full' },
    { id: 'full_name',   type: 'text',     label: 'Nom complet', required: true, placeholder: 'Sophie Martin', span: 'full' },
    { id: 'position',    type: 'text',     label: 'Fonction', placeholder: 'Responsable commercial' },
    { id: 'company',     type: 'text',     label: 'Société', placeholder: 'Prométhée Immobilier' },
    { id: 'description', type: 'textarea', label: 'Description', placeholder: 'Quelques mots de présentation…', span: 'full' },
    { id: 'phone_work',  type: 'tel',      label: 'Mobile (pro)', placeholder: '+33 6 12 34 56 78' },
    { id: 'phone',       type: 'tel',      label: 'Téléphone', placeholder: '+33 4 94 00 00 00' },
    { id: 'mobile',      type: 'tel',      label: 'Mobile', placeholder: '+33 7 88 99 00 11' },
    { id: 'fax',         type: 'tel',      label: 'Fax', placeholder: '+33 4 94 00 00 01' },
    { id: 'email',       type: 'email',    label: 'E-mail', placeholder: 'sophie@promethee.fr' },
    { id: 'website',     type: 'url',      label: 'Site web', placeholder: 'https://promethee.fr' },
    { id: 'accent_color',type: 'color',    label: 'Couleur d\'accent', default: '#4a90d9' },
  ],

  validate(template_data) {
    const d = template_data || {};
    return (d.full_name && String(d.full_name).trim()) ? [] : ['Le nom complet est obligatoire.'];
  },

  summary(template_data) {
    const d = template_data || {};
    const nom = (d.full_name || 'Carte de visite').toString().trim();
    const tail = [d.position, d.company].filter(Boolean).join(' · ');
    return tail ? `Carte de visite — ${nom} · ${tail}` : `Carte de visite — ${nom}`;
  },

  // Mini-aperçu (inline, autonome) : carte bleue + 3 boutons.
  previewMini() {
    return `<div style="padding:8px 10px">
      <div style="height:26px;border-radius:6px;background:#4a90d9;margin-bottom:6px"></div>
      <div style="display:flex;gap:4px"><div style="flex:1;height:12px;border-radius:4px;background:#4a90d9"></div><div style="flex:1;height:12px;border-radius:4px;background:#4a90d9"></div><div style="flex:1;height:12px;border-radius:4px;background:#4a90d9"></div></div>
    </div>`;
  },
};

export default TEMPLATE;
