// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · reseaux-sociaux
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/reseaux-sociaux.js.
// Page hébergée « suivez-moi » : photo + titre (smart_title) + un lien par
// réseau. Un réseau sans lien n'apparaît pas. Apparaît sous « Contact ».
// ══════════════════════════════════════════════════════════════════

// Réseaux proposés (le worker porte couleurs + glyphes + libellés d'appel).
const NETS = [
  ['facebook',  'Facebook',  'https://facebook.com/votre-page'],
  ['instagram', 'Instagram', 'https://instagram.com/votre-compte'],
  ['x',         'X',         'https://x.com/votre-compte'],
  ['linkedin',  'LinkedIn',  'https://linkedin.com/in/votre-profil'],
  ['youtube',   'YouTube',   'https://youtube.com/@votre-chaine'],
  ['tiktok',    'TikTok',    'https://tiktok.com/@votre-compte'],
  ['whatsapp',  'WhatsApp',  'https://wa.me/33612345678'],
  ['snapchat',  'Snapchat',  'https://snapchat.com/add/votre-compte'],
  ['telegram',  'Telegram',  'https://t.me/votre-compte'],
  ['spotify',   'Spotify',   'https://open.spotify.com/artist/…'],
  ['pinterest', 'Pinterest', 'https://pinterest.com/votre-compte'],
];

const TEMPLATE = {
  id:              'reseaux-sociaux',
  label:           'Réseaux sociaux',
  description:     'Page « suivez-moi » : photo, titre et un bouton par réseau (Facebook, Instagram, X, LinkedIn, TikTok…). Le visiteur clique et vous suit.',
  icon:            '🔗',
  tier_required:   'pro',
  noDestination:   true,   // page terminale : aucune redirection après (cf. sdqr.js)

  fields: [
    { id: 'photo_url', type: 'image', label: 'Photo / logo (rond, en haut)', maxBytes: 40000, maxDim: 600, span: 'full' },
    ...NETS.map(([id, label, ph]) => ({
      id: id + '_url', type: 'url', label: 'Lien ' + label, placeholder: ph, span: 'full',
    })),
  ],

  validate(template_data) {
    const d = template_data || {};
    const hasOne = NETS.some(([id]) => /^https?:\/\//i.test(String(d[id + '_url'] || '').trim()));
    return hasOne ? [] : ['Renseignez au moins un réseau (un lien commençant par http).'];
  },

  summary(template_data) {
    const d = template_data || {};
    const n = NETS.filter(([id]) => String(d[id + '_url'] || '').trim()).length;
    return `Réseaux sociaux — ${n} réseau${n > 1 ? 'x' : ''}`;
  },

  // Mini-aperçu (inline, autonome) : 3 pastilles colorées empilées.
  previewMini() {
    const bar = (c) => `<div style="height:9px;border-radius:4px;background:${c};margin-bottom:5px"></div>`;
    return `<div style="padding:8px 10px">${bar('#1877F2')}${bar('#E1306C')}${bar('#0A66C2')}</div>`;
  },
};

export default TEMPLATE;
