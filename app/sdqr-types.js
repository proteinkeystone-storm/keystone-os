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

// ── Registry public ────────────────────────────────────────────

export const QR_TYPES = {
  url: {
    label  : 'URL',
    icon   : '🔗',
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
    icon   : '📝',
    desc   : 'Note, message, clé',
    supports : { static: true, dynamic: false },
    fields : [
      { id: 'text', type: 'textarea', label: 'Contenu texte', required: true, placeholder: 'Note, message ou clé chiffrée…' },
    ],
    encode : _encodeText,
    preview: (p) => (p?.text || '').slice(0, 140) + ((p?.text || '').length > 140 ? '…' : ''),
  },

  vcard: {
    label  : 'vCard',
    icon   : '👤',
    desc   : 'Carte de contact',
    supports : { static: true, dynamic: false },
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
    icon   : '📶',
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
    icon   : '📅',
    desc   : 'Date + lieu + titre',
    supports : { static: true, dynamic: false },
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
