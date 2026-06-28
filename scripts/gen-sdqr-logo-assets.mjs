// ══════════════════════════════════════════════════════════════════
// Generateur : app/sdqr-logo-assets.js
// Lit les SVG du dossier « Picto SDQR » (marques + services), les nettoie
// (xml decl, commentaires, metadata Illustrator, espaces), corrige les
// logos blancs invisibles sur fond blanc (-> navy), et emet un module ES
// avec des data URLs prets a poser comme LOGO CENTRAL d'un QR.
// + pictos des pads Keystone (registre ui-renderer) et la puce Keystone.
//
//   node scripts/gen-sdqr-logo-assets.mjs
//
// Re-jouable : si on remplace un SVG du dossier, on relance et c'est a jour.
// 100% FRONT, aucune dependance, n'ecrit que app/sdqr-logo-assets.js.
// ══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FOLDER = path.resolve(ROOT, '../Picto SDQR');
const NAVY = '#1b2a4a';

// — Nettoyage d'un SVG complet (svgrepo / Illustrator) —
function cleanSvg(raw) {
  let s = raw;
  s = s.replace(/<\?xml[\s\S]*?\?>/g, '');             // declaration XML
  s = s.replace(/<!--[\s\S]*?-->/g, '');                // commentaires
  s = s.replace(/<!DOCTYPE[\s\S]*?>/gi, '');            // doctype
  // groupes watermark (export svgrepo/Illustrator)
  s = s.replace(/<g[^>]*id="watermark[^"]*"[\s\S]*?<\/g>\s*<\/g>/gi, '');
  s = s.replace(/<g[^>]*id="watermark[^"]*"[\s\S]*?<\/g>/gi, '');
  // attributs de taille fixes 800px -> on garde le viewBox seul
  s = s.replace(/\s(width|height)="[^"]*"/g, '');
  s = s.replace(/\sstyle="enable-background[^"]*"/g, '');
  s = s.replace(/\sxml:space="preserve"/g, '');
  s = s.replace(/\s(id|x|y|version)="[^"]*"/g, (m, a) => (a === 'id' ? m : '')); // garde id (gradients), retire x/y/version
  s = s.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
  return s;
}

// recolore tout fill blanc -> navy (logos « blancs » invisibles sur blanc)
function whiteToNavy(s) {
  return s
    .replace(/fill="#fff(fff)?"/gi, `fill="${NAVY}"`)
    .replace(/fill:\s*#fff(fff)?/gi, `fill:${NAVY}`)
    .replace(/fill="white"/gi, `fill="${NAVY}"`);
}

// logo « pastille » (Wi-Fi) : la forme de fond n'a pas de fill (-> noir par
// defaut, invisible/illisible) tandis que le texte est blanc. On colore le
// fond en navy et on GARDE le texte blanc -> lisible sur le masque blanc du QR.
function blobToNavy(s) {
  return s.replace(/<path d=/, `<path fill="${NAVY}" d=`);
}

function toDataUrl(svg) {
  // garde-fou : racine svg avec xmlns
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function fileToEntry({ file, id, label, recolor, recolorMode }) {
  let svg = cleanSvg(readFileSync(path.join(FOLDER, file), 'latin1'));
  if (recolorMode === 'blob') svg = blobToNavy(svg);
  else if (recolor) svg = whiteToNavy(svg);
  return { id, label, dataUrl: toDataUrl(svg) };
}

// — RESEAUX SOCIAUX (13, couleur reelle) — X et Threads authores inline
//   (X : fichier dossier watermarke 34Ko ; Threads : logo officiel, pas de fichier source) —
const X_CLEAN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="#0f1419"/></svg>';
const THREADS_CLEAN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 201 201"><path d="M100.734 200.291C155.963 200.291 200.734 155.506 200.734 100.261C200.734 45.0164 155.963 0.231689 100.734 0.231689C45.506 0.231689 0.734497 45.0164 0.734497 100.261C0.734497 155.506 45.506 200.291 100.734 200.291Z" fill="#000000"/><path d="M133.099 94.3599C151.029 101.908 159.85 119.977 154 138.676C150.013 151.439 138.655 161.749 126.484 166.41C111.14 172.305 90.5326 171.926 75.3981 165.646C44.7016 152.925 37.5408 117.601 40.5887 88.2132C42.7118 67.6424 51.274 47.5902 70.1781 37.2802C84.4228 29.4795 102.654 28.372 118.251 31.6381C134.444 35.0304 147.589 44.6115 155.555 59.1197C158.015 63.5703 160.004 68.4904 161.49 73.9642C161.532 74.1745 161.448 74.3918 161.238 74.4339L149.964 77.4056C149.754 77.4476 149.536 77.3215 149.494 77.1533C147.799 70.7052 145.129 64.979 141.437 59.9817C129.903 44.2891 108.75 40.0908 90.5187 43.3569C69.022 47.2187 57.1526 62.3157 53.6773 83.0477C50.8395 99.8828 51.7294 119.388 59.4859 134.913C66.0161 147.977 77.8435 155.308 92.0882 157.348C99.7606 158.406 107.265 158.28 114.601 156.92C125.118 154.972 136.392 148.012 140.967 138.046C143.938 131.598 144.232 123.418 140.967 117.012C139.103 113.368 136.301 110.438 132.615 108.237C132.447 108.111 132.188 108.195 132.104 108.363C132.062 108.406 132.062 108.448 132.062 108.49C131.634 111.629 130.92 114.72 129.855 117.734C128.327 122.017 126.127 125.71 123.198 128.717C113.361 138.852 96.2363 139.742 84.6612 132.446C75.4193 126.593 71.9439 114.636 76.3511 104.796C80.9265 94.6191 92.1232 90.2107 102.759 89.699C108.778 89.4047 114.335 89.657 119.464 90.3789C119.674 90.4209 119.842 90.2527 119.891 90.0425V89.9163C119.421 87.5823 118.875 85.676 118.195 84.1901C114.636 76.3473 106.62 74.2656 98.6115 75.2819C93.4826 75.9197 89.4536 78.3378 86.4407 82.494C86.3146 82.6622 86.1044 82.7042 85.9293 82.5781L76.3511 76.0459C76.1829 75.9198 76.141 75.7095 76.2671 75.4922C81.396 68.2801 88.3466 64.0819 97.1681 62.9394C104.462 61.9652 112.639 63.1076 119.001 66.9695C128.537 72.8218 131.928 83.342 132.776 93.9814C132.86 94.1917 132.944 94.3178 133.071 94.3599H133.099ZM87.3516 110.985C85.4458 117.391 89.8531 122.437 95.8298 123.958C104.224 126.082 113.55 124.21 117.537 115.603C119.106 112.211 120.038 108.223 120.332 103.689C120.332 103.478 120.206 103.31 120.038 103.31C113.809 102.084 107.405 101.824 100.875 102.462C95.5776 103.016 89.0052 105.434 87.3516 110.985Z" fill="#ffffff"/></svg>';

const SOCIAL = [
  { file: 'instagram-2-1-logo-svgrepo-com.svg', id: 'instagram', label: 'Instagram' },
  { __raw: THREADS_CLEAN,                       id: 'threads',   label: 'Threads' },
  { file: 'facebook-svgrepo-com.svg',           id: 'facebook',  label: 'Facebook' },
  { file: 'youtube-svgrepo-com.svg',            id: 'youtube',   label: 'YouTube' },
  { file: 'whatsapp-svgrepo-com.svg',           id: 'whatsapp',  label: 'WhatsApp' },
  { __raw: X_CLEAN,                             id: 'x',         label: 'X' },
  { file: 'tiktok-icon-white-1-logo-svgrepo-com.svg', id: 'tiktok', label: 'TikTok', recolor: true },
  { file: 'linkedin-svgrepo-com.svg',           id: 'linkedin',  label: 'LinkedIn' },
  { file: 'spotify-svgrepo-com.svg',            id: 'spotify',   label: 'Spotify' },
  { file: 'snapchat-logo-svgrepo-com.svg',      id: 'snapchat',  label: 'Snapchat' },
  { file: 'telegram-logo-svgrepo-com.svg',      id: 'telegram',  label: 'Telegram' },
  { file: 'pinterest-1-logo-svgrepo-com.svg',   id: 'pinterest', label: 'Pinterest' },
  { file: 'tripadvisor-logo-svgrepo-com.svg',   id: 'tripadvisor', label: 'TripAdvisor' },
];

// — SERVICES & UTILES (couleur reelle) —
const SERVUTILS = [
  { file: 'paypal-icon-logo-svgrepo-com.svg',   id: 'paypal',  label: 'PayPal' },
  { file: 'stripe-v2-svgrepo-com.svg',          id: 'stripe',  label: 'Stripe' },
  { file: 'acrobat-pro-cc-logo-svgrepo-com.svg', id: 'pdf',    label: 'PDF / Acrobat' },
  { file: 'wifi-logo-svgrepo-com.svg',          id: 'wifi',    label: 'Wi-Fi', recolorMode: 'blob' },
  { file: 'reception-ring-svgrepo-com.svg',     id: 'sonnette', label: 'Sonnette' },
];

function buildGroup(list) {
  return list.map(it => it.__raw
    ? { id: it.id, label: it.label, dataUrl: toDataUrl(it.__raw) }
    : fileToEntry(it));
}

// — APPS KEYSTONE : pictos pads (navy) + puce de marque —
// Tracés copiés du registre ICONS (app/ui-renderer.js) ; rendus navy plein trait.
const padLine = (inner, sw = 1.8) =>
  toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${NAVY}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`);

const PUCE_INNER = '<path d="M21,143.31c0-46.13,28.69-85.68,69.17-101.75l-7.72-19.53C34.2,41.19,0,88.33,0,143.31c0,41.61,19.59,78.73,50.03,102.63l12.94-16.52c-25.54-20.05-41.97-51.19-41.97-86.1Z"/><path d="M179.22,22.37l-7.86,19.47c40.11,16.24,68.48,55.6,68.48,101.47,0,35.02-16.54,66.25-42.22,86.29l12.9,16.56c30.61-23.89,50.32-61.11,50.32-102.85,0-54.67-33.82-101.58-81.63-120.94Z"/><path d="M229.14,143.31c0-41.38-25.59-76.89-61.78-91.54l-5.62,13.92c30.69,12.43,52.4,42.52,52.4,77.62,0,26.79-12.67,50.67-32.31,66l9.23,11.85c23.16-18.08,38.09-46.25,38.09-77.85Z"/><path d="M46.71,143.31c0-35.29,21.96-65.53,52.93-77.82l-5.53-13.97c-36.52,14.5-62.4,50.18-62.4,91.8,0,31.5,14.83,59.59,37.87,77.68l9.26-11.82c-19.54-15.34-32.13-39.15-32.13-65.86Z"/><circle cx="130.42" cy="143.31" r="24.46"/><path d="M108.68,65.49h42.9l19.79-60.83c-27.22-6.17-54.28-6.24-81.19,0l18.51,60.83Z"/>';

const KEYSTONE = [
  { id: 'keystone', label: 'Keystone', dataUrl: toDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260.85 246.17"><g fill="${NAVY}">${PUCE_INNER}</g></svg>`) },
  { id: 'sdqr', label: 'Smart Dynamic QR', dataUrl: padLine('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="2" height="2" fill="' + NAVY + '" stroke="none"/><rect x="16" y="16" width="2" height="2" fill="' + NAVY + '" stroke="none"/><rect x="19" y="14" width="2" height="2" fill="' + NAVY + '" stroke="none"/><rect x="14" y="19" width="2" height="2" fill="' + NAVY + '" stroke="none"/><rect x="19" y="19" width="2" height="2" fill="' + NAVY + '" stroke="none"/>') },
  { id: 'smart-agent', label: 'Smart Agent', dataUrl: padLine('<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/><path d="M19 1.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>') },
  { id: 'keynapse', label: 'Keynapse', dataUrl: padLine('<circle cx="6" cy="7" r="2.4"/><circle cx="17.5" cy="6" r="2"/><circle cx="13.5" cy="17" r="2.7"/><path d="M7.7 8.6l4.6 6.4"/><path d="M8.3 6.4l7.2-.2"/>', 1.5) },
  { id: 'keyform', label: 'Key Form', dataUrl: padLine('<rect x="2" y="2" width="14" height="14" rx="2"/><line x1="5" y1="6.5" x2="13" y2="6.5"/><line x1="5" y1="10.5" x2="11" y2="10.5"/><circle cx="17" cy="17" r="5"/><line x1="17" y1="14.5" x2="17" y2="19.5"/><line x1="14.5" y1="17" x2="19.5" y2="17"/>') },
  { id: 'sentinel', label: 'Sentinel', dataUrl: padLine('<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><path d="M17.99 11.66A6 6 0 0 1 15.77 16.67"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>') },
  { id: 'brainstorming', label: 'Brainstorming', dataUrl: padLine('<circle cx="12" cy="12" r="8.5" opacity="0.3"/><circle cx="12" cy="3.5" r="1.3"/><circle cx="17.5" cy="5.5" r="1.3"/><circle cx="20.5" cy="10.5" r="1.3"/><circle cx="19.4" cy="16.3" r="1.3"/><circle cx="14.9" cy="20" r="1.3"/><circle cx="9.1" cy="20" r="1.3"/><circle cx="4.6" cy="16.3" r="1.3"/><circle cx="3.5" cy="10.5" r="1.3"/><circle cx="6.5" cy="5.5" r="1.3"/>') },
  { id: 'ghostwriter', label: 'Ghost Writer', dataUrl: padLine('<line x1="3" y1="9" x2="17" y2="9"/><line x1="3" y1="13" x2="20" y2="13"/><line x1="3" y1="17" x2="13" y2="17"/><line x1="19" y1="3" x2="19" y2="7"/><line x1="17" y1="5" x2="21" y2="5"/>') },
  { id: 'social', label: 'Social Manager', dataUrl: padLine('<circle cx="12" cy="7" r="4"/><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>') },
  { id: 'brief', label: 'Brief Prod', dataUrl: padLine('<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5.5"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/><circle cx="12" cy="12" r="2" fill="' + NAVY + '"/>') },
  { id: 'vefa', label: 'Notices VEFA', dataUrl: padLine('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>', 1.5) },
  { id: 'annonces', label: 'Annonces Immo', dataUrl: padLine('<line x1="2" y1="5" x2="5" y2="5"/><line x1="8" y1="5" x2="22" y2="5"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="8" y1="12" x2="22" y2="12"/><line x1="2" y1="19" x2="5" y2="19"/><line x1="8" y1="19" x2="22" y2="19"/>') },
];

const out = `// ⚠ GENERE par scripts/gen-sdqr-logo-assets.mjs — NE PAS EDITER A LA MAIN.
// Logos/pictos prets a poser comme LOGO CENTRAL d'un QR (data URLs SVG).
// Source marques/services : dossier « Picto SDQR ». Apps : registre ui-renderer + puce.

export const LOGO_BRANDS = ${JSON.stringify(buildGroup(SOCIAL), null, 2)};

export const LOGO_SERVUTILS = ${JSON.stringify(buildGroup(SERVUTILS), null, 2)};

export const LOGO_KEYSTONE = ${JSON.stringify(KEYSTONE, null, 2)};
`;

const OUTFILE = path.join(ROOT, 'app/sdqr-logo-assets.js');
writeFileSync(OUTFILE, out);
const kb = (out.length / 1024).toFixed(1);
console.log(`OK -> app/sdqr-logo-assets.js (${kb} Ko)`);
console.log(`  marques: ${SOCIAL.length} · services&utiles: ${SERVUTILS.length} · apps Keystone: ${KEYSTONE.length}`);
