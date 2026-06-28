// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · key-ring (Sonnette / interphone)
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/key-ring.js.
// Sonnette / interphone par QR : page hebergee posee sur un portail / une
// porte / un accueil sans electricite. Le visiteur contacte l'occupant
// depuis SON telephone (Appeler / SMS / WhatsApp / E-mail). Apparait sous
// « Pratique » (1re page hebergee de cette famille).
//
// ORDRE 2 = skin interphone sombre + image haute (WebP) avec message en
// surimpression. ORDRE 3 = LIVRE : bouton « Sonner » (Web Push) + boucle
// retour (reponse) + destinataires multiples (onglet Sonneries, sdqr.js ;
// routes /api/keyring/* dans le worker). [Ce commentaire etait perime.]
// ══════════════════════════════════════════════════════════════════

const TEMPLATE = {
  id:              'key-ring',
  label:           'QR Ring',
  description:     'Interphone par QR : le visiteur vous appelle, vous écrit (SMS, WhatsApp) ou vous envoie un e-mail depuis son téléphone. Idéal pour un portail ou un accès sans électricité.',
  icon:            '🔔',
  tier_required:   'pro',
  noDestination:   true,   // page terminale : aucune redirection apres (cf. sdqr.js)

  fields: [
    { id: 'place_name', type: 'text',     label: 'Nom du lieu', required: true, placeholder: 'Le Portail', span: 'full' },
    { id: 'subtitle',   type: 'text',     label: 'Sous-titre', placeholder: 'Comment souhaitez-vous prévenir ?', span: 'full' },
    { id: 'hero_url',   type: 'image',    label: 'Image (haut de page) — WebP, PNG ou JPG', maxBytes: 90000, maxDim: 1100, span: 'full' },
    { id: 'notice',     type: 'text',     label: 'Message sur l\'image (optionnel)', placeholder: 'Attention au chien', span: 'full' },
    { id: 'phone',      type: 'tel',      label: 'Téléphone (Appeler / SMS)', placeholder: '06 00 00 00 00' },
    { id: 'whatsapp',   type: 'tel',      label: 'WhatsApp (format international)', placeholder: '33 6 00 00 00 00' },
    { id: 'email',      type: 'email',    label: 'E-mail', placeholder: 'vous@exemple.fr' },
    { id: 'message',    type: 'textarea', label: 'Message pré-rempli (SMS, WhatsApp, e-mail)', placeholder: 'Bonjour, je suis au portail.', span: 'full' },
    { id: 'accent_color', type: 'color',  label: 'Couleur du bouton « Sonner »', default: '#5b6cf5' },
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
    const lieu = (d.place_name || 'QR Ring').toString().trim();
    const n = [d.phone, d.whatsapp, d.email].filter(v => String(v || '').trim()).length;
    return `QR Ring — ${lieu}${n ? ` · ${n} moyen${n > 1 ? 's' : ''} de contact` : ''}`;
  },

  // Mini-apercu (inline, autonome) : interphone sombre (titre + image + 2
  // cartes + bouton Sonner).
  previewMini() {
    return `<div style="padding:8px 9px;background:#0b1019;border-radius:8px">
      <div style="height:7px;width:58%;margin:1px auto 5px;border-radius:4px;background:#fff;opacity:.85"></div>
      <div style="height:24px;border-radius:7px;background:linear-gradient(180deg,#1a2130,#121722);border:1px solid rgba(255,255,255,.08);margin-bottom:5px"></div>
      <div style="display:flex;gap:5px;margin-bottom:5px"><div style="flex:1;height:19px;border-radius:7px;background:#171c28;border:1px solid rgba(255,255,255,.07)"></div><div style="flex:1;height:19px;border-radius:7px;background:#171c28;border:1px solid rgba(255,255,255,.07)"></div></div>
      <div style="height:11px;border-radius:6px;background:#5b6cf5"></div>
    </div>`;
  },
};

export default TEMPLATE;
