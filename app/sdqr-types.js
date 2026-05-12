/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — SDQR Types Registry (Sprint SDQR-2)
   Définit les types de QR supportés, leurs champs de formulaire,
   et les encoders qui produisent la string à encoder dans les pixels.

   Convention payload : chaque type a un schéma de payload distinct.
   L'encoder reçoit ce payload et retourne la string finale (ex: une
   chaîne VCARD complète, une URL WIFI:..., un BEGIN:VEVENT...).

   Compatibilité Static / Dynamic :
     - URL    : les deux modes (dynamic = redirect Worker)
     - Texte  : static only
     - vCard  : static only (MVP — pourra devenir dynamic en SDQR-2.5
                via hébergement d'un .vcf derrière /r/<id>)
     - Wi-Fi  : static only
     - iCal   : static only
   ═══════════════════════════════════════════════════════════════ */

// ── Helpers d'échappement ──────────────────────────────────────

// Échappement pour le format WIFI:S:...;T:...;P:...;
// Caractères réservés : `;` `,` `"` `:` `\`
function _escWifi(s) {
  return String(s ?? '').replace(/([\\;,":])/g, '\\$1');
}

// Échappement pour VCARD et iCal (RFC 6350 / RFC 5545)
function _escIcs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Datetime-local "2026-05-20T18:00" → "20260520T180000"
function _datetimeIcal(dt) {
  if (!dt) return '';
  const clean = String(dt).replace(/[-:]/g, '');
  // datetime-local n'a pas de timezone → on encode en local sans Z
  return clean.length === 13 ? clean + '00' : clean;
}

// Timestamp UTC "now" pour DTSTAMP
function _nowUtcIcal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// ── Encoders ───────────────────────────────────────────────────

function _encodeText(payload) {
  return String(payload?.text || '').trim();
}

function _encodeUrl(payload) {
  return String(payload?.url || '').trim();
}

function _encodeWifi(payload) {
  const ssid     = _escWifi(payload?.ssid || '');
  const password = _escWifi(payload?.password || '');
  const security = (payload?.security || 'WPA2').toUpperCase();
  const hidden   = payload?.hidden ? 'H:true;' : '';
  // Format : WIFI:S:<ssid>;T:<security>;P:<password>;H:<hidden>;;
  // T:nopass si réseau ouvert (sans mot de passe)
  if (security === 'OPEN' || security === 'NOPASS') {
    return `WIFI:S:${ssid};T:nopass;${hidden};`;
  }
  return `WIFI:S:${ssid};T:${security};P:${password};${hidden};`;
}

function _encodeVcard(payload) {
  const lines = ['BEGIN:VCARD', 'VERSION:4.0'];

  const first = (payload?.firstName || '').trim();
  const last  = (payload?.lastName || '').trim();
  const fn    = [first, last].filter(Boolean).join(' ');
  if (fn) lines.push(`FN:${_escIcs(fn)}`);
  if (first || last) lines.push(`N:${_escIcs(last)};${_escIcs(first)};;;`);

  if (payload?.org)     lines.push(`ORG:${_escIcs(payload.org)}`);
  if (payload?.title)   lines.push(`TITLE:${_escIcs(payload.title)}`);
  if (payload?.phone)   lines.push(`TEL;TYPE=cell:${_escIcs(payload.phone)}`);
  if (payload?.email)   lines.push(`EMAIL:${_escIcs(payload.email)}`);
  if (payload?.address) lines.push(`ADR;TYPE=work:;;${_escIcs(payload.address)};;;;`);

  // Site web + réseaux sociaux (Sprint SDQR-2, demande Stéphane)
  if (payload?.website)   lines.push(`URL:${_escIcs(payload.website)}`);
  if (payload?.linkedin)  lines.push(`URL;TYPE=linkedin:${_escIcs(payload.linkedin)}`);
  if (payload?.instagram) lines.push(`URL;TYPE=instagram:${_escIcs(payload.instagram)}`);

  lines.push('END:VCARD');
  return lines.join('\n');
}

function _encodeIcal(payload) {
  const uid     = crypto.randomUUID();
  const dtstart = _datetimeIcal(payload?.start || '');
  const dtend   = _datetimeIcal(payload?.end || '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Keystone OS//SDQR//FR',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${_nowUtcIcal()}`,
  ];
  if (dtstart) lines.push(`DTSTART:${dtstart}`);
  if (dtend)   lines.push(`DTEND:${dtend}`);
  if (payload?.title)       lines.push(`SUMMARY:${_escIcs(payload.title)}`);
  if (payload?.location)    lines.push(`LOCATION:${_escIcs(payload.location)}`);
  if (payload?.description) lines.push(`DESCRIPTION:${_escIcs(payload.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\n');
}

// ── Icônes SVG outline (style Lucide, monochrome currentColor) ────
// 24x24 viewBox, fill:none, stroke:currentColor → s'adapte aux couleurs
// de la carte (gris inactif / or actif).
const _SVG = {
  url: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  vcard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  wifi: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`,
  ical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
};

// ── Registry public ────────────────────────────────────────────

export const QR_TYPES = {
  url: {
    label  : 'URL',
    icon   : _SVG.url,
    desc   : 'Lien web direct',
    supports : { static: true, dynamic: true },
    fields : [
      { id: 'url', type: 'url', label: 'URL', required: true, placeholder: 'https://…' },
    ],
    encode : _encodeUrl,
    preview: (p) => p?.url || '',
  },

  text: {
    label  : 'Texte',
    icon   : _SVG.text,
    desc   : 'Note, message, clé',
    supports : { static: true, dynamic: true },
    fields : [
      { id: 'text', type: 'textarea', label: 'Contenu texte', required: true, placeholder: 'Note, message ou clé chiffrée…' },
    ],
    encode : _encodeText,
    preview: (p) => (p?.text || '').slice(0, 140) + ((p?.text || '').length > 140 ? '…' : ''),
  },

  vcard: {
    label  : 'vCard',
    icon   : _SVG.vcard,
    desc   : 'Carte de contact',
    supports : { static: true, dynamic: true },
    fields : [
      { id: 'firstName', type: 'text',     label: 'Prénom',        required: true, placeholder: 'Sophie' },
      { id: 'lastName',  type: 'text',     label: 'Nom',           required: true, placeholder: 'Martin' },
      { id: 'org',       type: 'text',     label: 'Organisation',  placeholder: 'Prométhée Immobilier' },
      { id: 'title',     type: 'text',     label: 'Fonction',      placeholder: 'Responsable commercial' },
      { id: 'phone',     type: 'tel',      label: 'Téléphone',     placeholder: '+33 6 12 34 56 78' },
      { id: 'email',     type: 'email',    label: 'Email',         placeholder: 'sophie@promethee.fr' },
      { id: 'address',   type: 'textarea', label: 'Adresse',       placeholder: '5 rue Hoche, 83000 Toulon', span: 'full' },
      { id: 'website',   type: 'url',      label: 'Site web',      placeholder: 'https://promethee.fr' },
      { id: 'linkedin',  type: 'url',      label: 'LinkedIn',      placeholder: 'https://linkedin.com/in/…' },
      { id: 'instagram', type: 'url',      label: 'Instagram',     placeholder: 'https://instagram.com/…' },
    ],
    encode : _encodeVcard,
    preview: (p) => {
      const fn = [p?.firstName, p?.lastName].filter(Boolean).join(' ');
      const tail = [p?.title, p?.org].filter(Boolean).join(' · ');
      return fn + (tail ? ` — ${tail}` : '');
    },
  },

  wifi: {
    label  : 'Wi-Fi',
    icon   : _SVG.wifi,
    desc   : 'SSID + mot de passe',
    supports : { static: true, dynamic: false },
    fields : [
      { id: 'ssid',     type: 'text',     label: 'Nom du réseau (SSID)', required: true, placeholder: 'Bureau-WiFi' },
      { id: 'password', type: 'password', label: 'Mot de passe',         placeholder: 'Laisser vide si réseau ouvert' },
      { id: 'security', type: 'select',   label: 'Sécurité',             options: ['WPA2','WPA3','WPA','WEP','Open'], default: 'WPA2' },
      { id: 'hidden',   type: 'checkbox', label: 'Réseau caché (SSID non diffusé)' },
    ],
    encode : _encodeWifi,
    preview: (p) => `${p?.ssid || ''} (${p?.security || 'WPA2'})`,
  },

  ical: {
    label  : 'Événement',
    icon   : _SVG.ical,
    desc   : 'Date + lieu + titre',
    supports : { static: true, dynamic: true },
    fields : [
      { id: 'title',       type: 'text',           label: 'Titre',       required: true, placeholder: 'Visite chantier Programme Azur' },
      { id: 'location',    type: 'text',           label: 'Lieu',        placeholder: '12 avenue des Lauriers, Sanary' },
      { id: 'start',       type: 'datetime-local', label: 'Début',       required: true },
      { id: 'end',         type: 'datetime-local', label: 'Fin',         required: true },
      { id: 'description', type: 'textarea',       label: 'Description', placeholder: 'Détails complémentaires…', span: 'full' },
    ],
    encode : _encodeIcal,
    preview: (p) => {
      const d = p?.start ? new Date(p.start).toLocaleDateString('fr-FR') : '';
      return [p?.title, d, p?.location].filter(Boolean).join(' · ');
    },
  },
};

// Helper : la string finale à encoder dans les pixels du QR.
// Pour les dynamiques URL : on encode l'URL de redirect (passée en arg).
// Pour les statiques : on encode le payload selon le type.
export function encodePayload(type, payload, opts = {}) {
  if (opts.redirectUrl) return opts.redirectUrl;  // mode dynamique URL
  const def = QR_TYPES[type];
  if (!def) return '';
  return def.encode(payload || '');
}

export function previewSummary(type, payload) {
  const def = QR_TYPES[type];
  if (!def) return '';
  return def.preview(payload || {});
}
