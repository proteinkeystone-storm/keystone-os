// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · key-ring (Sonnette / interphone)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/key-ring.js.
// Sonnette / interphone par QR : page hebergee posee sur un portail / une
// porte / un accueil sans electricite. Le visiteur contacte l'occupant
// depuis SON telephone (Appeler / SMS / WhatsApp / E-mail). Apparait sous
// « Pratique » (1re page hebergee de cette famille).
//
// ORDRE 1 = champs + structure, SKIN NEUTRE. Le « Sonner » (Web Push) + la
// boucle retour + les destinataires arrivent a l'ORDRE 3.
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'key-ring',
  label:           'Sonnette',
  description:     'Interphone par QR : le visiteur vous appelle, vous écrit (SMS, WhatsApp) ou vous envoie un e-mail depuis son téléphone. Idéal pour un portail ou un accès sans électricité.',
  icon:            '🔔',
  tier_required:   'pro',
  noDestination:   true,   // page terminale : aucune redirection apres (cf. sdqr.js)

  fields: [
    { id: 'place_name', type: 'text',     label: 'Nom du lieu', required: true, placeholder: 'Le Portail', span: 'full' },
    { id: 'subtitle',   type: 'text',     label: 'Sous-titre', placeholder: 'Entrée principale', span: 'full' },
    { id: 'phone',      type: 'tel',      label: 'Téléphone (Appeler / SMS)', placeholder: '06 00 00 00 00' },
    { id: 'whatsapp',   type: 'tel',      label: 'WhatsApp (format international)', placeholder: '33 6 00 00 00 00' },
    { id: 'email',      type: 'email',    label: 'E-mail', placeholder: 'vous@exemple.fr' },
    { id: 'message',    type: 'textarea', label: 'Message pré-rempli (SMS, WhatsApp, e-mail)', placeholder: 'Bonjour, je suis au portail.', span: 'full' },
    { id: 'accent_color', type: 'color',  label: 'Couleur d\'accent', default: '#7c8af9' },
  ],

  validate(template_data) {
    const d = template_data || {};
    const errs = [];
    if (!(d.place_name && String(d.place_name).trim())) errs.push('Le nom du lieu est obligatoire.');
    const phone = String(d.phone || '').replace(/[^\d+]/g, '');
    const wa    = String(d.whatsapp || '').replace(/[^\d]/g, '');
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email || '').trim());
    if (!(phone || wa || email)) errs.push('Renseignez au moins un moyen de contact (téléphone, WhatsApp ou e-mail).');
    return errs;
  },

  summary(template_data) {
    const d = template_data || {};
    const lieu = (d.place_name || 'Sonnette').toString().trim();
    const n = [d.phone, d.whatsapp, d.email].filter(v => String(v || '').trim()).length;
    return `Sonnette — ${lieu}${n ? ` · ${n} moyen${n > 1 ? 's' : ''} de contact` : ''}`;
  },

  // Mini-apercu (inline, autonome) : plaque + gros bouton + 2 pastilles.
  previewMini() {
    return `<div style="padding:8px 10px">
      <div style="height:18px;border-radius:6px;background:#fff;border:1px solid #e2e7ef;margin-bottom:6px"></div>
      <div style="height:16px;border-radius:6px;background:#7c8af9;margin-bottom:6px"></div>
      <div style="display:flex;gap:5px"><div style="flex:1;height:12px;border-radius:4px;background:#eef1f8;border:1px solid #e2e7ef"></div><div style="flex:1;height:12px;border-radius:4px;background:#eef1f8;border:1px solid #e2e7ef"></div></div>
    </div>`;
  },
};

export default TEMPLATE;
