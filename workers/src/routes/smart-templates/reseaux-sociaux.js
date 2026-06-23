// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template (Worker) · reseaux-sociaux
// ───────────────────────────────────────────────────────────────────
// Page hébergée « link hub » réseaux sociaux (style link-in-bio), servie
// au scan via qr.js -> handleSmartQrInterstitial. Design validé par Stéphane
// (fond dégradé indigo->violet, photo ronde en haut, titre, boutons aux
// couleurs de marque). 100% statique, AUCUNE IA (zéro coût récurrent).
// Photo = data URI dans template_data.photo_url (champ image auto-compressé).
// Pendant frontend : app/sdqr-templates/reseaux-sociaux.js.
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, renderKeystoneFoot } from './_shared.js';

// Réseaux supportés : couleur de marque (bouton translucide) + glyphe BLANC +
// libellé d'appel par défaut. Le propriétaire colle son lien par réseau ;
// un réseau sans lien n'apparaît pas.
const NETWORKS = [
  { id: 'facebook',  color: '#1877F2', label: 'Likez moi sur Facebook',
    glyph: '<path d="M14 8.5V7c0-.7.3-1 1-1h1.6V3H14c-2 0-3.3 1.3-3.3 3.4V8.5H9v3h1.7V21H14v-9.5h2.2l.4-3z" fill="#fff"/>' },
  { id: 'instagram', color: '#E1306C', label: 'Suivez moi sur Instagram',
    glyph: '<rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="12" cy="12" r="4" fill="none" stroke="#fff" stroke-width="1.9"/><circle cx="17" cy="7" r="1.2" fill="#fff"/>' },
  { id: 'x',         color: '#1d1d1f', label: 'Suivez moi sur X',
    glyph: '<path d="M17.5 3h3l-7 8 8.2 10h-6.4l-5-6.1L8 21H5l7.4-8.5L4.5 3h6.6l4.4 5.6L17.5 3z" fill="#fff"/>' },
  { id: 'linkedin',  color: '#0A66C2', label: 'Connectons nous sur LinkedIn',
    glyph: '<path d="M6.5 8.5v10H3.5v-10zM5 3.5A1.8 1.8 0 1 1 5 7a1.8 1.8 0 0 1 0-3.5zM9 8.5h2.9v1.4c.5-.9 1.7-1.7 3.5-1.7 3 0 4.1 1.9 4.1 4.8v5.5h-3v-5c0-1.4-.5-2.3-1.8-2.3-1 0-1.6.7-1.9 1.4-.1.2-.1.5-.1.9v5H9z" fill="#fff"/>' },
  { id: 'youtube',   color: '#FF0000', label: 'Abonnez-vous sur YouTube',
    glyph: '<rect x="3" y="6.5" width="18" height="11" rx="3.2" fill="none" stroke="#fff" stroke-width="2"/><path d="M10.6 9.8 15 12l-4.4 2.2z" fill="#fff"/>' },
  { id: 'tiktok',    color: '#1d1d1f', label: 'Suivez-moi sur TikTok',
    glyph: '<path d="M14 3c.3 1.9 1.55 3.4 3.45 3.78v2.5a6.2 6.2 0 0 1-3.45-1.06v5.55A4.9 4.9 0 1 1 9.1 8.9c.28 0 .55.03.82.08v2.62a2.32 2.32 0 1 0 1.63 2.22V3z" fill="#fff"/>' },
  { id: 'whatsapp',  color: '#25D366', label: 'Écrivez-moi sur WhatsApp',
    glyph: '<path d="M12 3.4a8.6 8.6 0 0 0-7.4 13l-1 3.6 3.7-1a8.6 8.6 0 1 0 4.7-15.6z" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M9.5 8.3c-.15-.35-.3-.33-.44-.34h-.37c-.13 0-.34.05-.52.25s-.68.66-.68 1.6.7 1.86.8 2 1.36 2.18 3.36 2.96c1.66.66 2 .53 2.37.5.36-.04 1.16-.48 1.32-.94.16-.46.16-.85.11-.93-.05-.08-.18-.13-.38-.23s-1.2-.59-1.38-.66-.32-.1-.46.1-.52.66-.64.8-.24.15-.44.05-.85-.31-1.62-1-.84-1.2-1.12-1.4-.01-.31.09-.4l.3-.35c.1-.12.13-.2.2-.34s.03-.25-.02-.35-.46-1.1-.62-1.51z" fill="#fff"/>' },
  { id: 'snapchat',  color: '#C9A227', label: 'Ajoutez-moi sur Snapchat',
    glyph: '<path d="M12 4c2.2 0 3.5 1.6 3.6 3.8.02.84-.04 1.36.07 1.6.12.25.5.34.88.19.42-.17.86.04.95.34.1.32-.15.58-.7.8-.46.2-.95.3-.95.7 0 .47.98 1.2 1.92 1.58.37.15.28.62-.1.73-.46.14-.95.05-1.12.47-.12.3.02.7-.43.8-.5.13-1.1-.37-1.92-.15-.73.2-1.23.93-2.64.93s-1.9-.73-2.64-.93c-.82-.22-1.42.28-1.92.15-.45-.1-.3-.5-.43-.8-.17-.42-.66-.33-1.12-.47-.38-.11-.47-.58-.1-.73.94-.37 1.92-1.1 1.92-1.58 0-.4-.49-.5-.95-.7-.55-.22-.8-.48-.7-.8.1-.3.53-.5.95-.34.38.15.76.06.88-.19.11-.24.05-.76.07-1.6C8.5 5.6 9.8 4 12 4z" fill="#fff"/>' },
  { id: 'telegram',  color: '#2AABEE', label: 'Rejoignez-moi sur Telegram',
    glyph: '<path d="M5 11.7 18 6.8c.6-.22 1.13.14.93 1.04l-2.2 9.4c-.15.66-.55.82-1.12.5l-3-2.2-1.45 1.4c-.16.16-.3.3-.6.3l.2-3.1 5.5-5c.24-.2-.05-.32-.37-.12l-6.8 4.3-2.9-.9c-.64-.2-.65-.64.14-.95z" fill="#fff"/>' },
  { id: 'spotify',   color: '#1DB954', label: 'Écoutez-moi sur Spotify',
    glyph: '<circle cx="12" cy="12" r="9" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M7.6 10.4c3-1 6.6-.7 9 .85M8.1 13.1c2.4-.8 5.1-.5 7 .75M8.7 15.6c1.8-.55 3.7-.4 5.3.55" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>' },
  { id: 'pinterest', color: '#E60023', label: 'Suivez-moi sur Pinterest',
    glyph: '<path d="M12 3.5a8.5 8.5 0 0 0-3.1 16.4c-.07-.66-.13-1.7.03-2.43l.97-4.13s-.25-.5-.25-1.22c0-1.15.66-2 1.5-2 .7 0 1.04.53 1.04 1.16 0 .7-.45 1.76-.68 2.74-.2.82.41 1.49 1.22 1.49 1.46 0 2.45-1.88 2.45-4.1 0-1.69-1.14-2.96-3.21-2.96a3.66 3.66 0 0 0-3.8 3.69c0 .67.2 1.14.5 1.5.14.17.16.24.1.43l-.15.6c-.05.2-.2.26-.45.15-1.06-.43-1.55-1.6-1.55-2.9 0-2.16 1.82-4.74 5.43-4.74 2.9 0 4.8 2.1 4.8 4.35 0 2.98-1.66 5.2-4.1 5.2-.82 0-1.6-.44-1.86-.94l-.5 2c-.18.7-.67 1.57-1 2.1A8.5 8.5 0 1 0 12 3.5z" fill="#fff"/>' },
];

const AVATAR = '<svg viewBox="0 0 24 24" width="66" height="66" fill="#fff" aria-hidden="true"><circle cx="12" cy="9" r="4.4"/><path d="M3.5 21c0-4.2 3.8-7 8.5-7s8.5 2.8 8.5 7z"/></svg>';

const TEMPLATE = {
  id:            'reseaux-sociaux',
  label:         'Réseaux sociaux',
  description:   'Page « suivez-moi » : photo, titre et boutons vers vos réseaux (Facebook, Instagram, X, LinkedIn, TikTok, YouTube…).',
  tier_required: 'pro',
  noDestination: true,   // page terminale : pas de CTA « continuer » vers target_url

  validate(template_data) {
    const d = template_data || {};
    const hasOne = NETWORKS.some(n => safeUrl(d[n.id + '_url']) || /^https?:\/\//i.test(String(d[n.id + '_url'] || '').trim()));
    return hasOne ? [] : ['Renseignez au moins un réseau (un lien).'];
  },

  renderHTML(qrData, scanCtx) {
    const d        = qrData?.template_data || {};
    const title    = escHtml((qrData?.smart_title || 'Suivez moi sur les réseaux').toString().slice(0, 80));
    const photo    = safeUrl(d.photo_url);
    const photoEl  = photo
      ? `<img src="${photo}" alt="" referrerpolicy="no-referrer">`
      : AVATAR;

    const buttons = NETWORKS.map(n => {
      // Lien : on tolère un http(s) brut (safeUrl impose déjà http(s)/data;
      // ici un lien réseau = toujours http(s)).
      const raw = String(d[n.id + '_url'] || '').trim();
      const href = /^https?:\/\//i.test(raw) ? raw.replace(/["'<>]/g, '') : '';
      if (!href) return '';
      return `<a class="net" href="${href}" target="_blank" rel="noopener noreferrer" style="background:${n.color}8f">`
        + `<span class="net-ico"><svg viewBox="0 0 24 24" width="26" height="26">${n.glyph}</svg></span>`
        + `<span class="net-div"></span>`
        + `<span class="net-txt">${escHtml(n.label)}</span></a>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${title} · Keystone</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100vh; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    letter-spacing: -0.01em;
    background: linear-gradient(177deg, #0a0e20 0%, #141538 32%, #291b5c 64%, #4a2b8e 100%);
    background-attachment: fixed; color: #fff;
    min-height: 100vh;
    padding: calc(40px + env(safe-area-inset-top,0px)) 26px calc(40px + env(safe-area-inset-bottom,0px));
  }
  .wrap { max-width: 460px; margin: 0 auto; text-align: center; }
  .photo { width: 104px; height: 104px; border-radius: 50%; margin: 8px auto 26px;
    background: linear-gradient(150deg, #c3d4e8, #9fb8d6); border: 3px solid rgba(255,255,255,.28);
    display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .photo img { width: 100%; height: 100%; object-fit: cover; }
  h1 { font-size: 23px; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 30px; }
  .net { display: flex; align-items: center; height: 62px; border-radius: 15px;
    margin: 0 0 16px; overflow: hidden; border: 1px solid rgba(255,255,255,.16);
    text-decoration: none; -webkit-tap-highlight-color: transparent;
    transition: transform .12s ease, filter .12s ease; }
  .net:active { transform: scale(.985); filter: brightness(1.08); }
  .net-ico { width: 56px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
  .net-div { width: 1px; height: 30px; background: rgba(255,255,255,.30); flex: 0 0 auto; }
  .net-txt { color: #fff; font-size: 14px; font-weight: 600; padding-left: 16px; text-align: left; }
  .sq-foot { margin: 26px 0 0; font-size: 11px; color: rgba(255,255,255,.55); text-align: center; }
  .sq-foot a { color: rgba(255,255,255,.7); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="photo">${photoEl}</div>
    <h1>${title}</h1>
    ${buttons || '<p style="color:rgba(255,255,255,.7);font-size:14px">Aucun réseau renseigné.</p>'}
    ${renderKeystoneFoot()}
  </div>
</body>
</html>`;
  },
};

export default TEMPLATE;
