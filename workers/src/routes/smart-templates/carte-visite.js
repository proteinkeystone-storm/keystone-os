// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — Smart Template (Worker) · carte-visite
// ───────────────────────────────────────────────────────────────────
// Page hébergée « carte de visite » (link-in-bio) servie au scan. 5 designs
// sélectionnables (template_data.layout '1'..'5'), validés par Stéphane.
// 100% statique, AUCUNE IA. Photo = data URI dans template_data.photo_url.
// Coexiste avec la vCard native (qui, elle, ouvre direct les Contacts).
// Pendant frontend : app/sdqr-templates/carte-visite.js.
// ══════════════════════════════════════════════════════════════════

import { escHtml, safeUrl, safeColor, renderKeystoneFoot } from './_shared.js';

const ICON = {
  phone: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.3 2.2z"/></svg>',
  mail:  '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  web:   '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15 0 18M12 3c-2.6 2.6-2.6 15 0 18"/></svg>',
  fax:   '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="9" rx="2"/><path d="M7 18v3h10v-3"/></svg>',
};
const avatar = (s) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="#fff" aria-hidden="true"><circle cx="12" cy="9" r="4.4"/><path d="M3.5 21c0-4.2 3.8-7 8.5-7s8.5 2.8 8.5 7z"/></svg>`;

function telHref(v)  { const n = String(v || '').replace(/[^\d+]/g, ''); return n ? 'tel:' + n : ''; }
function mailHref(v) { const e = String(v || '').trim(); return (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/[<>"'\\]/.test(e)) ? 'mailto:' + e : ''; }

const TEMPLATE = {
  id:            'carte-visite',
  label:         'Carte de visite',
  description:   'Carte de visite en page (link-in-bio) : photo, nom, fonction, boutons Appeler / E-mail / Site et coordonnées. 5 designs au choix.',
  tier_required: 'pro',
  noDestination: true,   // page terminale : pas de CTA « continuer » vers target_url

  validate(template_data) {
    const d = template_data || {};
    return (d.full_name && String(d.full_name).trim()) ? [] : ['Le nom est obligatoire.'];
  },

  renderHTML(qrData, scanCtx) {
    const d    = qrData?.template_data || {};
    const acc  = safeColor(d.accent_color, '#4a90d9');
    const name = escHtml((d.full_name || 'Votre Nom').toString().slice(0, 60));
    const posBits = [d.position, d.company].map(x => escHtml(String(x || '').trim())).filter(Boolean);
    const pos  = posBits.join(' · ');
    const desc = escHtml((d.description || '').toString().slice(0, 240));
    const photo = safeUrl(d.photo_url);
    const layout = ['1', '2', '3', '4', '5'].includes(String(d.layout)) ? String(d.layout) : '1';

    const photoEl = (sz) => photo
      ? `<img src="${photo}" alt="" referrerpolicy="no-referrer">`
      : avatar(sz);

    // Boutons d'action (n'apparaissent que si la cible existe).
    const callTo = telHref(d.phone_work || d.mobile || d.phone);
    const mailTo = mailHref(d.email);
    const webTo  = safeUrl(d.website) && /^https?:\/\//i.test(String(d.website).trim()) ? String(d.website).trim().replace(/["'<>]/g, '') : '';
    const ACTS = [
      callTo && { href: callTo, ic: 'phone', l: 'Appeler' },
      mailTo && { href: mailTo, ic: 'mail',  l: 'E-mail' },
      webTo  && { href: webTo,  ic: 'web',   l: 'Site', blank: true },
    ].filter(Boolean);

    const actSquares = () => `<div class="acts">${ACTS.map(a =>
      `<a class="act-sq" href="${escHtml(a.href)}"${a.blank ? ' target="_blank" rel="noopener"' : ''}><span class="ai">${ICON[a.ic]}</span><small>${a.l}</small></a>`).join('')}</div>`;
    const actPills = () => `<div class="acts-col">${ACTS.map(a =>
      `<a class="act-pill" href="${escHtml(a.href)}"${a.blank ? ' target="_blank" rel="noopener"' : ''}>${ICON[a.ic]} ${a.l}</a>`).join('')}</div>`;
    const actTabs = (boxed) => `<div class="tabs ${boxed ? 'tabs-boxed' : ''}">${ACTS.map((a, i) =>
      `<a class="tab" href="${escHtml(a.href)}"${a.blank ? ' target="_blank" rel="noopener"' : ''}${i ? ' style="border-left:1px solid rgba(0,0,0,.07)"' : ''}>${ICON[a.ic]} ${a.l}</a>`).join('')}</div>`;

    // Lignes de coordonnées (uniquement celles renseignées).
    const ROWS = [
      d.phone_work && { ic: 'phone', l: 'Mobile (pro)', v: d.phone_work, href: telHref(d.phone_work) },
      d.phone      && { ic: 'phone', l: 'Téléphone',    v: d.phone,      href: telHref(d.phone) },
      d.mobile     && { ic: 'phone', l: 'Mobile',       v: d.mobile,     href: telHref(d.mobile) },
      d.fax        && { ic: 'fax',   l: 'Fax',          v: d.fax,        href: '' },
      d.email      && { ic: 'mail',  l: 'E-mail',       v: d.email,      href: mailHref(d.email) },
      webTo        && { ic: 'web',   l: 'Site web',     v: String(d.website).replace(/^https?:\/\//i, ''), href: webTo, blank: true },
    ].filter(Boolean);
    const rows = (card) => ROWS.map(r => {
      const inner = `<span class="ric">${ICON[r.ic]}</span><div class="rtxt"><div class="rlab">${escHtml(r.l)}</div><div class="rval">${escHtml(String(r.v).slice(0, 90))}</div></div>`;
      return r.href
        ? `<a class="row ${card ? 'rowcard' : ''}" href="${escHtml(r.href)}"${r.blank ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`
        : `<div class="row ${card ? 'rowcard' : ''}">${inner}</div>`;
    }).join('');

    const descEl = desc ? `<div class="desc">${desc}</div>` : '';

    let body;
    if (layout === '1') {
      body = `<div class="hdr1" style="background:${acc}">
          <div class="ph ph-sm">${photoEl(58)}</div>
          <div class="name">${name}</div>${pos ? `<div class="pos">${pos}</div>` : ''}
        </div>
        ${ACTS.length ? actTabs(false) : ''}
        ${desc ? `<div class="desc desc-pad">${desc}</div>` : ''}
        <div class="list">${rows(false)}</div>`;
    } else if (layout === '2') {
      body = `<div class="hdr2" style="background:${acc}">
          <div class="name">${name}</div>${pos ? `<div class="pos">${pos}</div>` : ''}
        </div>
        <div class="ph ph-lg ph-overlap">${photoEl(92)}</div>
        ${descEl}
        ${ACTS.length ? `<div class="pad-x">${actSquares()}</div>` : ''}
        <div class="list list-cards">${rows(true)}</div>`;
    } else if (layout === '3') {
      body = `<div class="pad-x pt-card">
          <div class="card3" style="background:${acc}">
            <div class="ph ph-md ph-pop">${photoEl(64)}</div>
            <div class="name">${name}</div>${pos ? `<div class="pos">${pos}</div>` : ''}
            ${desc ? `<div class="desc desc-on">${desc}</div>` : ''}
            ${ACTS.length ? actTabs(true) : ''}
          </div>
        </div>
        <div class="list">${rows(false)}</div>`;
    } else if (layout === '4') {
      body = `<div class="ph-top">${photoEl(100)}</div>
        <div class="pad-x">
          <div class="card4" style="background:${acc}">
            <div class="name">${name}</div>${pos ? `<div class="pos">${pos}</div>` : ''}
            ${desc ? `<div class="desc desc-on">${desc}</div>` : ''}
            ${ACTS.length ? actSquares() : ''}
          </div>
        </div>
        <div class="list list-cards">${rows(true)}</div>`;
    } else {
      body = `<div class="ph-hero">${photoEl(120)}<svg class="wave" viewBox="0 0 400 34" preserveAspectRatio="none"><path d="M0 34 V14 Q200 40 400 14 V34 Z" fill="#eef2f7"/></svg></div>
        <div class="pad-x center">
          <div class="name dark">${name}</div>${pos ? `<div class="pos pos-dark">${pos}</div>` : ''}
          ${descEl}
          ${ACTS.length ? actPills() : ''}
        </div>
        <div class="list">${rows(false)}</div>`;
    }

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${name} · Carte de visite</title>
<style>
  :root { --acc:${acc}; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin:0; padding:0; min-height:100vh; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; letter-spacing:-0.01em;
    background:#eef2f7; color:#1c1c1e; min-height:100vh; }
  .page { max-width:480px; margin:0 auto; min-height:100vh; background:#eef2f7;
    padding-bottom: calc(28px + env(safe-area-inset-bottom,0px)); }
  a { text-decoration:none; color:inherit; -webkit-tap-highlight-color:transparent; }
  .pad-x { padding:0 16px; }
  .center { text-align:center; }
  .name { font-weight:800; letter-spacing:-0.02em; font-size:21px; color:#fff; }
  .name.dark { color:#243b5e; }
  .pos { font-weight:500; font-size:12px; color:#fff; opacity:.92; }
  .pos.pos-dark { color:#7b8aa3; opacity:1; }
  .desc { color:#8a96a8; font-size:12px; text-align:center; padding:12px 16px 4px; }
  .desc.desc-pad { background:#fff; }
  .desc.desc-on { color:#eaf1fb; padding:8px 0 12px; }
  .ph { border-radius:50%; background:linear-gradient(150deg,#dfe9f5,#cdd9ea); border:3px solid #fff;
    display:flex; align-items:center; justify-content:center; overflow:hidden; margin:0 auto; }
  .ph img { width:100%; height:100%; object-fit:cover; }
  .ph-sm { width:74px; height:74px; margin-bottom:10px; }
  .ph-md { width:82px; height:82px; }
  .ph-lg { width:118px; height:118px; }
  .ph-overlap { margin-top:-38px; }
  .ph-pop { position:absolute; top:-41px; left:50%; transform:translateX(-50%); }
  /* En-têtes */
  .hdr1 { border-radius:0 0 26px 26px; padding: calc(env(safe-area-inset-top,0px) + 44px) 0 20px; text-align:center; }
  .hdr2 { height:158px; border-radius:0 0 52% 52% / 0 0 40px 40px; text-align:center;
    padding-top: calc(env(safe-area-inset-top,0px) + 46px); }
  .pt-card { padding-top: calc(env(safe-area-inset-top,0px) + 78px); }
  .card3 { border-radius:20px; padding:52px 16px 18px; text-align:center; position:relative; }
  .card4 { border-radius:20px; padding:16px; text-align:center; margin-top:16px; }
  .ph-top { text-align:center; padding: calc(env(safe-area-inset-top,0px) + 44px) 0 0; }
  .ph-top .ph, .card4 + * .ph { width:128px; height:128px; }
  .ph-top > svg { display:none; }
  .ph-hero { height:208px; background:linear-gradient(150deg,#c3d4e8,#9fb8d6); position:relative; overflow:hidden;
    display:flex; align-items:center; justify-content:center;
    padding-top: env(safe-area-inset-top,0px); }
  .ph-hero > svg.wave { position:absolute; bottom:-1px; left:0; width:100%; height:34px; z-index:1; }
  /* Photo plein cadre : couvre toute la zone haute, le wave courbe le bas. */
  .ph-hero img { width:100%; height:100%; object-fit:cover; }
  /* Sans photo : la silhouette garde sa taille, centrée sur le dégradé. */
  /* Boutons d'action */
  .acts { display:flex; gap:10px; padding:0 0 4px; }
  .act-sq { flex:1; background:var(--acc); color:#fff; border-radius:12px; padding:11px 0; text-align:center; }
  .act-sq .ai { display:block; margin:0 auto 5px; }
  .act-sq small { font-size:11px; font-weight:600; }
  .acts-col { display:flex; flex-direction:column; gap:10px; padding-top:4px; }
  .act-pill { display:flex; align-items:center; justify-content:center; gap:9px; background:var(--acc); color:#fff;
    border-radius:26px; padding:13px; font-size:14px; font-weight:600; }
  .tabs { display:flex; background:#fff; border-bottom:1px solid #eef0f4; }
  .tabs.tabs-boxed { background:#fff; border-radius:11px; border-bottom:0; overflow:hidden; }
  .tab { flex:1; display:flex; align-items:center; justify-content:center; gap:7px; color:var(--acc);
    font-size:12.5px; font-weight:600; padding:13px 6px; }
  /* Lignes */
  .list { background:#eef2f7; }
  .list-cards { padding-top:6px; }
  .row { display:flex; align-items:center; gap:13px; padding:12px 18px; background:#fff; border-bottom:1px solid #eef0f4; }
  .row.rowcard { margin:0 16px 10px; border-radius:13px; border:none; box-shadow:0 1px 5px rgba(20,40,80,.07); }
  .ric { width:28px; color:var(--acc); flex:0 0 auto; text-align:center; }
  .rlab { font-size:10px; color:#aab2c0; }
  .rval { font-size:13px; color:#2b3a55; font-weight:500; word-break:break-word; }
  .sq-foot { margin:22px 0 0; font-size:11px; color:#9aa7b8; text-align:center; }
  .sq-foot a { color:#6b7790; }
</style>
</head>
<body>
  <div class="page">${body}${renderKeystoneFoot()}</div>
</body>
</html>`;
  },
};

export default TEMPLATE;
