// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template Frontend · carte-visite
// ───────────────────────────────────────────────────────────────────
// Pendant frontend de workers/src/routes/smart-templates/carte-visite.js.
// Carte de visite en page (link-in-bio), 5 designs. Apparaît sous « Contact »
// À CÔTÉ de la vCard native (qui, elle, enregistre direct dans les Contacts).
// ══════════════════════════════════════════════════════════════════

// Mini-gabarits (squelettes) pour le sélecteur de design par vignettes.
// Classes CSS : .cvt / .cvt-blue / .cvt-circ / .cvt-rows / .cvt-acts (style.css).
const _R = '<div class="cvt-rows"><i></i><i></i><i></i></div>';
const _acts = (s) => `<div class="cvt-acts" style="margin-top:7px"><i style="${s}"></i><i style="${s}"></i><i style="${s}"></i></div>`;
function _cvThumb(n) {
  const circ = (s) => `<div class="cvt-circ" style="${s}"></div>`;
  if (n === '1') return `<div class="cvt"><div class="cvt-blue" style="height:40%;border-radius:0 0 8px 8px"></div>${circ('width:26%;aspect-ratio:1;top:13%')}${_acts('height:6px;border-radius:2px;background:#cfe0f3')}${_R}</div>`;
  if (n === '2') return `<div class="cvt"><div class="cvt-blue" style="height:34%;border-radius:0 0 50% 50%/0 0 10px 10px"></div>${circ('width:30%;aspect-ratio:1;top:22%')}<div style="height:16%"></div>${_acts('height:13px;border-radius:3px;background:#4a90d9')}${_R}</div>`;
  if (n === '3') return `<div class="cvt"><div style="height:12%"></div><div class="cvt-blue" style="height:40%;margin:0 7%;border-radius:7px"></div>${circ('width:24%;aspect-ratio:1;top:8%')}<div style="margin:6px 14% 0;height:9px;border-radius:5px;background:#fff;border:1px solid #cfe0f3"></div>${_R}</div>`;
  if (n === '4') return `<div class="cvt">${circ('width:34%;aspect-ratio:1;position:static;left:auto;transform:none;margin:9px auto 0')}<div class="cvt-blue" style="margin:6px 7% 0;height:28%;border-radius:7px"></div>${_acts('height:12px;border-radius:3px;background:#4a90d9')}${_R}</div>`;
  return `<div class="cvt"><div class="cvt-blue" style="height:32%;border-radius:0 0 40% 40%/0 0 12px 12px"></div><div style="padding:7px 8px 0;display:flex;flex-direction:column;gap:4px"><i style="height:8px;border-radius:5px;background:#4a90d9;display:block"></i><i style="height:8px;border-radius:5px;background:#4a90d9;display:block"></i><i style="height:8px;border-radius:5px;background:#4a90d9;display:block"></i></div>${_R}</div>`;
}

const TEMPLATE = {
  id:              'carte-visite',
  label:           'Carte de visite',
  description:     'Carte de visite en page : photo, nom, fonction, boutons Appeler / E-mail / Site + coordonnées. 5 designs au choix. (La vCard native, elle, enregistre direct dans les Contacts.)',
  icon:            '🪪',
  tier_required:   'pro',
  noDestination:   true,   // page terminale : aucune redirection après (cf. sdqr.js)

  fields: [
    { id: 'layout', type: 'cards', label: 'Design de la carte', default: '1', span: 'full',
      options: [
        { value: '1', label: 'Bandeau bleu',  thumb: _cvThumb('1') },
        { value: '2', label: 'Vague + photo', thumb: _cvThumb('2') },
        { value: '3', label: 'Médaillon',     thumb: _cvThumb('3') },
        { value: '4', label: 'Photo en haut', thumb: _cvThumb('4') },
        { value: '5', label: 'Plein cadre',   thumb: _cvThumb('5') },
      ],
    },
    { id: 'photo_url',   type: 'image',    label: 'Photo', maxBytes: 55000, maxDim: 900, span: 'full' },
    { id: 'full_name',   type: 'text',     label: 'Nom complet', required: true, placeholder: 'Prénom Nom', span: 'full' },
    { id: 'position',    type: 'text',     label: 'Fonction', placeholder: 'Votre fonction' },
    { id: 'company',     type: 'text',     label: 'Société', placeholder: 'Votre société' },
    { id: 'description', type: 'textarea', label: 'Description', placeholder: 'Quelques mots de présentation…', span: 'full' },
    { id: 'phone_work',  type: 'tel',      label: 'Mobile (pro)', placeholder: '06 00 00 00 00' },
    { id: 'phone',       type: 'tel',      label: 'Téléphone', placeholder: '01 00 00 00 00' },
    { id: 'mobile',      type: 'tel',      label: 'Mobile', placeholder: '07 00 00 00 00' },
    { id: 'fax',         type: 'tel',      label: 'Fax', placeholder: '01 00 00 00 01' },
    { id: 'email',       type: 'email',    label: 'E-mail', placeholder: 'vous@exemple.fr' },
    { id: 'website',     type: 'url',      label: 'Site web', placeholder: 'https://votre-site.fr' },
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
