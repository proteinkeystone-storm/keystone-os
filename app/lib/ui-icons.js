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
  'bell'       : '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  'pin'        : '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
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
  // Smart Agent (O-AGT-001) — tête d'agent + étincelle de savoir (variante du 'robot'
  // Lucide "bot" : l'étincelle = la connaissance qui l'alimente). Identité du pad.
  'smart-agent': '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/><path d="M19 1.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>',
  // Kortex — le coffre de savoir du Smart Agent (style Lucide "archive") : fiches typées validées.
  'kortex'     : '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  // Keynapse (O-Keyn-001) — constellation de bulles reliées (synapse).
  'keynapse'   : '<circle cx="6" cy="7" r="2.4"/><circle cx="17.5" cy="6" r="2"/><circle cx="13.5" cy="17" r="2.7"/><path d="M7.7 8.6l4.6 6.4"/><path d="M8.3 6.4l7.2-.2"/>',
  // Key Brand (O-BRD-001) — atelier de design (planche, stylet, gabarits) :
  // identité du pad charte graphique vivante. Picto choisi par Stéphane
  // (design-studio, SVG Repo, licence libre) — fill-based comme 'sceau'.
  'keybrand'   : '<g fill="currentColor" stroke="none"><path d="M17,6 L17,16.2792476 L18.5,17.7902865 L20,16.2792476 L20,6 L17,6 Z M17,5 L20,5 L20,3.01471863 L17,3.01471863 L17,5 Z M21,7 L21,16.4852814 C21,16.6172545 20.9478236,16.7438756 20.8548472,16.8375362 L18.8548472,18.8522548 C18.6592928,19.0492484 18.3407072,19.0492484 18.1451528,18.8522548 L16.1451528,16.8375362 C16.0521764,16.7438756 16,16.6172545 16,16.4852814 L16,14 L15.5,14 C14.6715729,14 14,13.3284271 14,12.5 L14,9.5 C14,8.67157288 14.6715729,8 15.5,8 L16,8 L16,7 L6,7 L6,14.5 C6,14.7761424 5.77614237,15 5.5,15 L5,15 C3.34314575,15 2,16.3431458 2,18 C2,19.6568542 3.34314575,21 5,21 L22,21 L22,7 L21,7 Z M21,6 L22.5,6 C22.7761424,6 23,6.22385763 23,6.5 L23,21.5 C23,21.7761424 22.7761424,22 22.5,22 L5,22 C2.790861,22 1,20.209139 1,18 L1,6.5 C1,4.01471863 3.01471863,2 5.5,2 C5.77614237,2 6,2.22385763 6,2.5 L6,6 L16,6 L16,2.51471863 C16,2.23857625 16.2238576,2.01471863 16.5,2.01471863 L20.5,2.01471863 C20.7761424,2.01471863 21,2.23857625 21,2.51471863 L21,6 Z M16,9 L15.5,9 C15.2238576,9 15,9.22385763 15,9.5 L15,12.5 C15,12.7761424 15.2238576,13 15.5,13 L16,13 L16,9 Z M2,15.3541756 C2.73294445,14.5237549 3.80530747,14 5,14 L5,3.03544443 C3.30385293,3.27805926 2,4.73676405 2,6.5 L2,15.3541756 L2,15.3541756 Z M8.5,8 L11.5,8 C12.3284271,8 13,8.67157288 13,9.5 L13,12.5 C13,13.3284271 12.3284271,14 11.5,14 L8.5,14 C7.67157288,14 7,13.3284271 7,12.5 L7,9.5 C7,8.67157288 7.67157288,8 8.5,8 Z M8.5,9 C8.22385763,9 8,9.22385763 8,9.5 L8,12.5 C8,12.7761424 8.22385763,13 8.5,13 L11.5,13 C11.7761424,13 12,12.7761424 12,12.5 L12,9.5 C12,9.22385763 11.7761424,9 11.5,9 L8.5,9 Z M7.5,17 C7.22385763,17 7,16.7761424 7,16.5 C7,16.2238576 7.22385763,16 7.5,16 L14.5,16 C14.7761424,16 15,16.2238576 15,16.5 C15,16.7761424 14.7761424,17 14.5,17 L7.5,17 Z M7.5,19 C7.22385763,19 7,18.7761424 7,18.5 C7,18.2238576 7.22385763,18 7.5,18 L15.5,18 C15.7761424,18 16,18.2238576 16,18.5 C16,18.7761424 15.7761424,19 15.5,19 L7.5,19 Z"/></g>',
  // Sentinel (O-GEO-001) — radar de surveillance (style Lucide "radar") : audit web continu.
  'sentinel'   : '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  // Loupe (style Lucide "search") — recherche hybride du coffre Kortex (SA-2).
  'search'     : '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'mail'       : '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'send'       : '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  'share'      : '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  'bar-chart'  : '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  // Living Layer V2 — mode Pilotable (annonce admin pushée par Stéphane).
  // Picto outline 1.5 cohérent avec la charte Keystone.
  'megaphone'  : '<path d="M3 11v3a1 1 0 0 0 1 1h2.51L11 18.5V6.5L6.51 10H4a1 1 0 0 0-1 1z"/><path d="M15 8a4 4 0 0 1 0 8"/><path d="M19 5a8 8 0 0 1 0 14"/>',
  // SA-8.0 — gabarits métier du Smart Agent (concierge / guide / artisan).
  'key'        : '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3-3.5 3.5z"/>',
  // SA-9 — pack Agent immobilier.
  'home'       : '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  'compass'    : '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  'tool'       : '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',

  // Steps / catégories
  'target'     : '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  'edit'       : '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'package'    : '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  'sparkles'   : '<path d="M12 3l1.7 4.6 4.6 1.7-4.6 1.7L12 15.6l-1.7-4.6L5.7 9.3l4.6-1.7L12 3z"/><path d="M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8L19 14z"/><path d="M5 14l.8 2.2 2.2.8-2.2.8L5 20l-.8-2.2-2.2-.8 2.2-.8L5 14z"/>',
  'printer'    : '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  'globe'      : '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'book-open'  : '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'custom'     : '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/>',
  // Dossier d'agents (SA-4.4.1) — style Lucide "folder".
  'folder'     : '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',

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
  'paperclip'  : '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
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
  // radio : ondes NFC/sans-contact (bouton « écrire sur puce »).
  'radio': '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  // sceau : picto brand du Pad O-SEC-001 — bouclier AILÉ (sécurité + message
  // qui voyage, inspiration Hermès). Bouclier central + check + 2 ailes/côté.
  'sceau': '<g transform="scale(0.03) translate(-120.0,-121.8) scale(1.3)" fill="currentColor" stroke="none"><path d="M344.9,229.5c-21.7,7-43.3,14.6-64.6,22.8c-4,1.5-6.9,5.5-7.5,10.4c-12.6,110.6,16.5,191.2,51.3,244.4 c14.7,22.7,32.3,42.7,52.1,59.4c7.9,6.5,14.9,11.2,20.3,14.2c2.7,1.5,5,2.5,6.7,3.1c0.7,0.3,1.5,0.5,2.3,0.7 c0.8-0.1,1.5-0.4,2.3-0.7c1.7-0.6,4-1.6,6.7-3.1c5.5-3,12.5-7.7,20.3-14.2c19.8-16.6,37.4-36.7,52.1-59.4 c34.8-53.1,64-133.8,51.3-244.4c-0.6-4.8-3.5-8.9-7.5-10.4c-14.8-5.7-39.9-14.9-64.6-22.7c-25.3-8-48.6-13.9-60.7-13.9 C393.5,215.6,370.2,221.5,344.9,229.5L344.9,229.5z M338.8,202.1c24.7-7.8,51-14.9,66.7-14.9s42,7,66.7,14.9 c25.3,8,50.8,17.4,65.8,23.1c12.8,4.9,22,18,23.8,33.6c13.6,119.1-17.9,207.3-56.2,265.7c-16.2,25-35.5,47-57.4,65.2 c-7.5,6.3-15.5,11.9-23.9,16.6c-6.4,3.5-13.2,6.4-18.9,6.4s-12.5-2.9-18.9-6.4c-8.4-4.7-16.3-10.3-23.9-16.6 c-21.8-18.3-41.1-40.3-57.4-65.2c-38.2-58.4-69.8-146.6-56.2-265.7c1.8-15.6,11-28.6,23.8-33.6 C294.8,216.9,316.7,209.2,338.8,202.1z"/><path d="M493.8,315.6c5.7,5.7,5.7,14.9,0,20.6c0,0,0,0,0,0l-87.5,87.5c-5.7,5.7-14.9,5.7-20.6,0c0,0,0,0,0,0L341.9,380 c-5.7-5.7-5.7-14.9,0-20.6s14.9-5.7,20.6,0l33.4,33.4l77.2-77.2C478.8,309.9,488,309.9,493.8,315.6 C493.8,315.6,493.8,315.6,493.8,315.6z"/><path d="M328,533.5c-22.8-11.6-36.7-32.4-38.7-51.9C278.4,377.5,104,370.3,11.7,269.3l0,0C21.1,401.9,166.9,396,255.1,459.4 c-56.4-22-147.3-13.4-214.8-53.8c34.4,98.8,142.9,61.9,224.4,86.1c-48.1-2.9-110.4,26.5-171,7.2c55.8,81.3,122.3,23.2,188.7,21.3 c-33.2,9.7-66.4,48.3-112.7,46.5c58.3,52.1,85.9-1.5,125.5-23.2c-3.9,5-6.2,11.3-6.3,18.1c-0.1,16.5,13.1,29.9,29.6,30 c16.5,0.1,29.9-13.1,30-29.6C348.7,548.7,340,537.4,328,533.5L328,533.5z"/><path d="M472,533.5c-12,3.9-20.7,15.3-20.6,28.6c0.1,16.5,13.6,29.7,30,29.6c16.5-0.1,29.7-13.6,29.6-30 c-0.1-6.8-2.4-13.1-6.3-18.1c39.6,21.6,67.2,75.3,125.5,23.2c-46.3,1.8-79.6-36.8-112.7-46.5c66.4,1.9,132.9,60,188.7-21.3 c-60.6,19.2-122.9-10.1-171-7.2c81.5-24.2,190,12.7,224.4-86.1c-67.5,40.4-158.3,31.7-214.8,53.8c88.3-63.4,234-57.5,243.4-190.1 l0,0c-92.3,101-266.7,108.2-277.5,212.3C508.7,501.1,494.9,521.9,472,533.5L472,533.5z"/></g>',
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
  // Vocal (Smart Agent) — dictée (micro) + lecture à voix haute (haut-parleur on/off), style Lucide.
  'mic'            : '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  'volume-2'       : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  'volume-x'       : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  // Jour / Nuit (Key Brand — teinte claire/sombre de la couleur de marque).
  'sun'            : '<circle cx="12" cy="12" r="4.2"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/><line x1="5.4" y1="5.4" x2="7.1" y2="7.1"/><line x1="16.9" y1="16.9" x2="18.6" y2="18.6"/><line x1="5.4" y1="18.6" x2="7.1" y2="16.9"/><line x1="16.9" y1="7.1" x2="18.6" y2="5.4"/>',
  'moon'           : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  // Étoiles de notation (test de visibilité) : contour + version pleine.
  'star'           : '<polygon points="12 2.5 15.1 8.8 22 9.8 17 14.7 18.2 21.6 12 18.3 5.8 21.6 7 14.7 2 9.8 8.9 8.8 12 2.5"/>',
  'star-fill'      : '<polygon points="12 2.5 15.1 8.8 22 9.8 17 14.7 18.2 21.6 12 18.3 5.8 21.6 7 14.7 2 9.8 8.9 8.8 12 2.5" fill="currentColor"/>',
  // Agrandir (aperçu du test de visibilité).
  'maximize'       : '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  // Alignements & interligne (barre d'outils typographie).
  'align-left'     : '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="17" y2="18"/>',
  'align-center'   : '<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/>',
  'align-right'    : '<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="7" y1="18" x2="20" y2="18"/>',
  'align-justify'  : '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
  'line-height'    : '<path d="M4 5l3-3 3 3M4 19l3 3 3-3M7 2v20"/><line x1="13" y1="6" x2="21" y2="6"/><line x1="13" y1="12" x2="21" y2="12"/><line x1="13" y1="18" x2="21" y2="18"/>',
  'info'           : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
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
