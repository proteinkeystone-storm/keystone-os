/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — UI Icons (lib partagée)
   Sprint Phase E1

   Pictogrammes outline 1.5 stroke (style Lucide), réutilisables
   partout dans Keystone — workspaces fullscreen, pads modaux,
   admin "La Fabrique", landing, etc.

   Usage :
     import { icon } from './lib/ui-icons.js';
     button.innerHTML = `${icon('save', 18)} Sauvegarder`;

   Le SVG retourné utilise `currentColor` pour le stroke — la
   couleur de l'icône suit donc la color CSS du parent.
   ═══════════════════════════════════════════════════════════════ */

export const ICONS = {
  // Navigation & actions
  'arrow-left' : '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  'x'          : '<path d="M18 6L6 18M6 6l12 12"/>',
  'check'      : '<polyline points="20 6 9 17 4 12"/>',
  'chevron-right': '<polyline points="9 18 15 12 9 6"/>',
  'chevron-left' : '<polyline points="15 18 9 12 15 6"/>',
  'chevron-up'   : '<polyline points="18 15 12 9 6 15"/>',
  'chevron-down' : '<polyline points="6 9 12 15 18 9"/>',
  'download'   : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  'save'       : '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor"/>',
  'more-horizontal': '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/>',
  'plus'       : '<path d="M12 5v14M5 12h14"/>',
  'minus'      : '<path d="M5 12h14"/>',
  'history'    : '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'calendar'   : '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'clock'      : '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'trash-2'    : '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  'refresh'    : '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  'settings'   : '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'eye'        : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off'    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  'lock'       : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock'     : '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'share-2'    : '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  // Silhouette humaine minimaliste (style Lucide "user") — picto du pad Social Manager (O-SOC-001).
  'user'       : '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'mail'       : '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'send'       : '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'bar-chart'  : '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  // Living Layer V2 — mode Pilotable (annonce admin pushée par Stéphane).
  // Picto outline 1.5 cohérent avec la charte Keystone.
  'megaphone'  : '<path d="M3 11v3a1 1 0 0 0 1 1h2.51L11 18.5V6.5L6.51 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a4 4 0 0 1 0 8"/><path d="M19 5a8 8 0 0 1 0 14"/>',

  // Steps / catégories
  'target'     : '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  'edit'       : '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'package'    : '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  'sparkles'   : '<path d="M12 3l1.7 4.6 4.6 1.7-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3z"/><path d="M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8L19 14z"/><path d="M5 14l.8 2.2 2.2.8-2.2.8L5 20l-.8-2.2-2.2-.8 2.2-.8L5 14z"/>',
  'printer'    : '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  'globe'      : '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'book-open'  : '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'custom'     : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',

  // Assets / éléments visuels
  'image'      : '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  // Help-Overlay v2 — zone vidéo de démo (lecteur + placeholder "bientôt").
  'film'       : '<rect x="2.5" y="3" width="19" height="18" rx="2.5" ry="2.5"/><line x1="7.5" y1="3" x2="7.5" y2="21"/><line x1="16.5" y1="3" x2="16.5" y2="21"/><line x1="2.5" y1="12" x2="21.5" y2="12"/><line x1="2.5" y1="7.5" x2="7.5" y2="7.5"/><line x1="2.5" y1="16.5" x2="7.5" y2="16.5"/><line x1="16.5" y1="7.5" x2="21.5" y2="7.5"/><line x1="16.5" y1="16.5" x2="21.5" y2="16.5"/>',
  'play'       : '<polygon points="6 4 20 12 6 20 6 4"/>',
  'palette'    : '<circle cx="12" cy="12" r="10"/><circle cx="6.5" cy="11.5" r="1.5" fill="currentColor"/><circle cx="9.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1.5" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor"/><path d="M12 22a10 10 0 0 1 0-20c5 0 8 4 7 8a5 5 0 0 1-5 4h-2.5a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 1-1.5 5z"/>',
  'type'       : '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  'upload-cloud': '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/>',
  'file-text'  : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  'check-square': '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'file'       : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  'copy'       : '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'shield-check': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',

  // Tools spécifiques
  'ruler'      : '<path d="M21.3 8.7L8.7 21.3a1 1 0 0 1-1.4 0L2.7 16.7a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z"/><path d="M7.5 10.5l2 2M11 7l1.5 1.5M14.5 3.5l2 2M4 14l2 2M14 4l-1 1M19 9l-1 1M5 19l1-1M18 14l1 1"/>',
  'building'   : '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="9" y1="6" x2="9" y2="6"/><line x1="9" y1="10" x2="9" y2="10"/><line x1="9" y1="14" x2="9" y2="14"/><line x1="15" y1="6" x2="15" y2="6"/><line x1="15" y1="10" x2="15" y2="10"/><line x1="15" y1="14" x2="15" y2="14"/>',
  'qr-code'    : '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="17"/><line x1="14" y1="20" x2="14" y2="21"/><line x1="17" y1="14" x2="17" y2="14"/><line x1="20" y1="14" x2="20" y2="14"/><line x1="17" y1="17" x2="17" y2="21"/><line x1="20" y1="17" x2="20" y2="21"/>',
  'zap'        : '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'sliders'    : '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',

  // Réseaux sociaux — pictos brand outline 1.5 (style Lucide, usage descriptif/fonctionnel)
  'instagram': '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
  'linkedin' : '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  'facebook' : '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  'pinterest': '<circle cx="12" cy="12" r="10"/><path d="M9.5 22 L11 13"/><circle cx="13" cy="11" r="3"/>',

  // Pictogrammes brand des artefacts (miroir du registre ICONS du dashboard
  // dans ui-renderer.js — extraits pour réutilisation dans les headers d'artefacts).
  'kodex': '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  'pulsa': '<rect x="2" y="2" width="14" height="14" rx="2"/><line x1="5" y1="6.5" x2="13" y2="6.5"/><line x1="5" y1="10.5" x2="11" y2="10.5"/><circle cx="17" cy="17" r="5"/><line x1="17" y1="14.5" x2="17" y2="19.5"/><line x1="14.5" y1="17" x2="19.5" y2="17"/>',
  'sdqr': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="16" y="16" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="19" width="2" height="2" fill="currentColor" stroke="none"/><rect x="19" y="19" width="2" height="2" fill="currentColor" stroke="none"/>',
  // muse : 9 nœuds en table ronde — AI War Room (V2, mai 2026).
  // Le picto reprend l'identité « boardroom multi-agent » de l'artefact
  // refondu (anciennement nuancier 3 swatches du moodboard studio 3D).
  'muse': '<circle cx="12" cy="12" r="8.5" opacity="0.3"/><circle cx="12" cy="3.5" r="1.3"/><circle cx="17.5" cy="5.5" r="1.3"/><circle cx="20.5" cy="10.5" r="1.3"/><circle cx="19.4" cy="16.3" r="1.3"/><circle cx="14.9" cy="20" r="1.3"/><circle cx="9.1" cy="20" r="1.3"/><circle cx="4.6" cy="16.3" r="1.3"/><circle cx="3.5" cy="10.5" r="1.3"/><circle cx="6.5" cy="5.5" r="1.3"/>',
  // Sprint VEFA-Studio-1 — Pictogramme miroir de ICONS['vefa'] dans ui-renderer.js
  // pour réutilisation dans la topbar de l'artefact O-IMM-010.
  'vefa': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  // Phase 3 — Pictogramme miroir de ICONS['multiportails'] dans ui-renderer.js
  // (diffusion multi-portails : 3 lignes courtes + 3 longues)
  'multiportails': '<line x1="2" y1="5" x2="5" y2="5"/><line x1="8" y1="5" x2="22" y2="5"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="8" y1="12" x2="22" y2="12"/><line x1="2" y1="19" x2="5" y2="19"/><line x1="8" y1="19" x2="22" y2="19"/>',

  // Sprint GW-2 — Pictogramme miroir de ICONS['ghostwriter'] dans ui-renderer.js
  // pour réutilisation dans la topbar de l'artefact A-COM-005.
  'ghostwriter': '<line x1="3" y1="9" x2="17" y2="9"/><line x1="3" y1="13" x2="20" y2="13"/><line x1="3" y1="17" x2="13" y2="17"/><line x1="19" y1="3" x2="19" y2="7"/><line x1="17" y1="5" x2="21" y2="5"/>',

  // ── AI War Room — 9 personnalités-agents (Sprint 0, mai 2026) ──
  // Pictos outline 1.8 (style Lucide), 1 par agent du boardroom.
  // Couleur appliquée via CSS (currentColor) en accord avec la
  // personnalité de l'agent (bleu profond, violet, vert, ambre,
  // or, cyan, argent, rouge, blanc neutre).
  'agent-strategic': '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  'agent-creative' : '<path d="M9 18h6"/><path d="M10 21.5h4"/><path d="M12 2.5a6.5 6.5 0 0 0-3.7 11.8c.7.5 1.2 1.2 1.2 2v.7"/><path d="M14.5 17v-.7c0-.8.5-1.5 1.2-2A6.5 6.5 0 0 0 12 2.5z"/>',
  'agent-growth'   : '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
  'agent-consumer' : '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/>',
  'agent-brand'    : '<path d="M12 2.5 3.5 5.5v6c0 5.2 3.7 9.8 8.5 11 4.8-1.2 8.5-5.8 8.5-11v-6L12 2.5z"/>',
  'agent-cultural' : '<path d="M5 12.5a8 8 0 0 1 14 0"/><path d="M2 9a13 13 0 0 1 20 0"/><path d="M8.5 16.5a4 4 0 0 1 7 0"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/>',
  'agent-data'     : '<line x1="3" y1="20.5" x2="21" y2="20.5"/><line x1="6.5" y1="20.5" x2="6.5" y2="14"/><line x1="12" y1="20.5" x2="12" y2="9"/><line x1="17.5" y1="20.5" x2="17.5" y2="11.5"/>',
  'agent-devil'    : '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'agent-synth'    : '<path d="M12 3l1.6 4.4 4.4 1.6-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M18 16l.7 1.9 1.9.7-1.9.7L18 21l-.7-1.9L15.4 18.6l1.9-.7L18 16z"/>',
  'alert-triangle' : '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  'threads'        : '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
  'telegram'       : '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  // Bot / assistant (style Lucide "bot") — ex. wizard de connexion réseau.
  'robot'          : '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  // Lien / connexion (style Lucide "link").
  'link'           : '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

/**
 * Retourne le HTML d'une icône outline 1.5px.
 *
 * @param {string} name Nom de l'icône (voir ICONS).
 * @param {number} size Taille en pixels (défaut 20).
 * @returns {string}    HTML avec <span class="ws-icon"><svg>…</svg></span>
 */
export function icon(name, size = 20) {
  const body = ICONS[name];
  if (!body) return '';
  return `<span class="ws-icon" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg></span>`;
}
