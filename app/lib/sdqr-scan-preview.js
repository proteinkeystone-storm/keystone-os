// ══════════════════════════════════════════════════════════════════
// KEYSTONE OS — SDQR : aperçu « Au scan »
// ───────────────────────────────────────────────────────────────────
// Rend un vrai iPhone (bon ratio, entièrement visible) dont l'écran montre
// CE QUE LE VISITEUR obtient une fois le QR scanné, selon le type choisi —
// piloté par le payload saisi. 100% front, PUR : ne touche jamais le QR
// imprimé, /r/:shortId ni les redirections. Module sans dépendance d'état :
//   scanPreviewHtml(cre, design)
//     cre    = { mode, type, template_id, concierge_source, payload,
//                smart_title, smart_message }
//     design = blob de design fusionné (_editingDesign) — pour la couleur d'accent
// Réutilisable : aperçu de création, fiche détail, banc d'essai.
// ══════════════════════════════════════════════════════════════════

import { getTemplate } from '../sdqr-templates/index.js';

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const _SP_ICON = {
  lock : '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  wifi : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a11 11 0 0 1 14 0"/><path d="M2 9a16 16 0 0 1 20 0"/><path d="M8.5 16a6 6 0 0 1 7 0"/><line x1="12" y1="19.6" x2="12.01" y2="19.6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  back : '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><polyline points="15 18 9 12 15 6"/></svg>',
  user : '<svg viewBox="0 0 24 24" width="25" height="25" fill="#9bb0d0"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.4 0 .7-.2 1l-2.3 2.2z"/></svg>',
};
function _spSend(c) {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}
function _spStar(c) { return `<svg viewBox="0 0 24 24" width="18" height="18" fill="${c}"><path d="M12 2l2.9 6.3 6.6.6-5 4.4 1.5 6.5L12 17l-6 3.3 1.5-6.5-5-4.4 6.6-.6z"/></svg>`; }
function _spPin(c)  { return `<svg viewBox="0 0 24 24" width="30" height="30" fill="${c}" stroke="#fff" stroke-width="1.3"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.4" fill="#fff" stroke="none"/></svg>`; }
function _spGift()  { return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="1.5"/><path d="M3 12h18M12 8v13M12 8S9 3 6.5 4.5 9 8 12 8zM12 8s3-5 5.5-3.5S15 8 12 8z"/></svg>`; }

// Heure + wifi + batterie. `light` = texte blanc (posé sur un header coloré).
function _spStatus(light) {
  const c = light ? '#fff' : '#1c1c1e';
  return `<div class="sdqr-sp-sb" style="color:${c}"><span>9:41</span>`
    + `<span class="sdqr-sp-sbr">${_SP_ICON.wifi}<span class="sdqr-sp-batt"><span class="sdqr-sp-battf"></span></span></span></div>`;
}
function _spDevice(inner, bg) {
  return `<div class="sdqr-iph"><div class="sdqr-iph-scr" style="background:${bg || '#fff'}">`
    + `${inner}<div class="sdqr-iph-home"></div></div></div>`;
}
// Valeur saisie, ou placeholder grisé si vide (l'aperçu n'est jamais vide).
function _spVal(v, ph) {
  const s = (v == null ? '' : String(v)).trim();
  return s ? _esc(s) : `<span class="sdqr-sp-mut">${_esc(ph)}</span>`;
}
function _acc(design) {
  return (design?.eye?.distinct && design.eye.color) ? design.eye.color : (design?.fg || '#6c6cf5');
}
// Texte lisible (#fff vs foncé) posé sur une couleur d'accent — sans dépendance.
function _onColor(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.62 ? '#11182f' : '#fff';
}

export function scanPreviewHtml(cre, design) {
  cre = cre || {};
  const p = cre.payload || {};
  if (cre.mode === 'smart') return _spDevice(_spExperience(cre, design), '#fff');
  switch (cre.type) {
    case 'url'     : return _spDevice(_spBrowser(p),  '#fff');
    case 'text'    : return _spDevice(_spText(p),     '#fff');
    case 'vcard'   : return _spDevice(_spVcard(p),    '#fff');
    case 'wifi'    : return _spDevice(_spWifi(p),     '#8e98a6');
    case 'ical'    : return _spDevice(_spIcal(p),     '#fff');
    case 'email'   : return _spDevice(_spEmail(p),    '#fff');
    case 'sms'     : return _spDevice(_spSms(p),      '#fff');
    case 'whatsapp': return _spDevice(_spWhatsapp(p), '#ECE5DD');
    case 'tel'     : return _spDevice(_spTel(p),      '#fff');
    case 'geo'     : return _spDevice(_spGeo(p),      '#e7edf0');
    default        : return _spDevice(_spBrowser(p),  '#fff');
  }
}

// ── Expériences : la VRAIE page hébergée (renderHTML worker) ────────
// On réutilise LE MÊME moteur de rendu que la page servie au scan (source de
// vérité worker), importé paresseusement côté front (servi en statique). Rendu
// dans une iframe sandbox SANS scripts → frame statique fidèle, zéro effet de
// bord (pas de fetch jeux/tampons). Repli automatique sur l'écran stylisé
// (_spExperience) si /workers n'est plus servi → jamais d'aperçu cassé.
let _wtPromise = null;
function _loadWorkerTemplates() {
  if (!_wtPromise) {
    _wtPromise = import('../../workers/src/routes/smart-templates/index.js').catch(() => null);
  }
  return _wtPromise;
}
function _qrDataFromCre(cre) {
  return {
    template_id : cre.template_id,
    smart_title : cre.smart_title || '',
    smart_message: cre.smart_message || '',
    name        : cre.smart_title || cre.name || '',
    template_data: cre.template_data || {},
    short_id    : 'PREVIEW',
  };
}
function _expIframe(html) {
  const srcdoc = String(html).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<div class="sdqr-iph"><div class="sdqr-iph-scr">`
    + `<iframe class="sdqr-iph-frame" sandbox="" title="Aperçu de la page" srcdoc="${srcdoc}"></iframe>`
    + `<div class="sdqr-iph-home"></div></div></div>`;
}

// Rend l'aperçu d'une EXPÉRIENCE dans `host` (async : import paresseux du
// moteur worker). Garde-fou anti-reload : ne recharge l'iframe que si la donnée
// a changé. Repli stylisé si le moteur worker est indisponible.
export async function renderExperiencePreview(host, cre, design) {
  if (!host) return;
  const key = [cre.template_id, cre.smart_title || '', cre.smart_message || '',
    JSON.stringify(cre.template_data || {})].join('|');
  if (host.__expKey === key && host.querySelector('iframe.sdqr-iph-frame')) return;
  const mod = await _loadWorkerTemplates();
  if (!mod || typeof mod.getTemplate !== 'function') {
    host.innerHTML = _spDevice(_spExperience(cre, design), '#fff'); host.__expKey = null; return;
  }
  try {
    const html = mod.getTemplate(cre.template_id).renderHTML(_qrDataFromCre(cre), {});
    host.innerHTML = _expIframe(html);
    host.__expKey = key;
  } catch (e) {
    host.innerHTML = _spDevice(_spExperience(cre, design), '#fff'); host.__expKey = null;
  }
}

function _spBrowser(p) {
  const raw  = (p.url || '').trim().replace(/^https?:\/\//i, '');
  const host = raw ? raw.split(/[\/?#]/)[0] : 'votre-site.com';
  const ini  = (host.replace(/^www\./, '')[0] || 'W').toUpperCase();
  return _spStatus(false)
    + `<div class="sdqr-sp-omni">${_SP_ICON.lock}${_esc(host)}</div>`
    + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:0 22px">`
      + `<div style="width:44px;height:44px;border-radius:12px;background:#1b2a4a;color:#c9a84c;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px">${_esc(ini)}</div>`
      + `<div style="font-size:13px;font-weight:600;color:#1c1c1e;margin-top:10px;word-break:break-word">${_esc(host)}</div>`
      + `<div style="height:7px;width:118px;background:#eef1f6;border-radius:4px;margin-top:12px"></div>`
      + `<div style="height:7px;width:84px;background:#eef1f6;border-radius:4px;margin-top:6px"></div>`
    + `</div>`;
}

function _spText(p) {
  const txt = (p.text || '').trim();
  return _spStatus(false)
    + `<div class="sdqr-sp-nav"><span>${_SP_ICON.chevL} Notes</span><span>OK</span></div>`
    + `<div class="sdqr-sp-body" style="padding:2px 16px 16px"><div style="font-size:12px;color:#1c1c1e;line-height:1.5;white-space:pre-wrap;word-break:break-word">`
    + (txt ? _esc(txt) : '<span class="sdqr-sp-mut">Votre note, message ou clé s\'affiche ici.</span>')
    + `</div></div>`;
}

function _spVcard(p) {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  const ini  = ((p.firstName || '')[0] || '') + ((p.lastName || '')[0] || '');
  const sub  = [p.title, p.org].filter(Boolean).join(' · ');
  const row  = (l, v, ph, link) => `<div class="sdqr-sp-row"><span class="l">${l}</span><span class="v"${link ? ' style="color:#007AFF"' : ''}>${_spVal(v, ph)}</span></div>`;
  return _spStatus(false)
    + `<div class="sdqr-sp-nav"><span>Annuler</span><b>Contact</b><span style="font-weight:600">Ajouter</span></div>`
    + `<div class="sdqr-sp-body">`
      + `<div style="display:flex;flex-direction:column;align-items:center;padding:9px 0 8px">`
        + `<div class="sdqr-sp-avatar">${ini ? _esc(ini.toUpperCase()) : _SP_ICON.user}</div>`
        + `<div style="font-size:14px;font-weight:600;color:#1c1c1e;margin-top:8px">${name ? _esc(name) : '<span class="sdqr-sp-mut">Prénom Nom</span>'}</div>`
        + (sub ? `<div style="font-size:10px;color:#8a8a8e;margin-top:1px">${_esc(sub)}</div>` : '')
      + `</div>`
      + `<div style="border-top:.5px solid #ececef">`
        + row('mobile', p.phone, '+33 6 …', true)
        + row('e-mail', p.email, 'nom@exemple.fr', true)
        + (p.org ? row('société', p.org, '', false) : '')
        + (p.website ? row('site', (p.website || '').replace(/^https?:\/\//i, ''), '', true) : '')
      + `</div></div>`;
}

function _spWifi(p) {
  const ssid = (p.ssid || '').trim();
  return _spStatus(true)
    + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;padding:0 18px">`
      + `<div style="width:190px;background:rgba(249,249,251,.97);border-radius:14px;overflow:hidden;text-align:center">`
        + `<div style="padding:15px 15px 12px"><div style="font-size:13px;font-weight:600;color:#1c1c1e">Wi-Fi</div>`
        + `<div style="font-size:11px;color:#3c3c43;margin-top:6px;line-height:1.4">Voulez-vous rejoindre le réseau « ${ssid ? _esc(ssid) : '…'} » ?</div></div>`
        + `<div style="display:flex;border-top:.5px solid #d2d2d7"><div style="flex:1;padding:10px;font-size:12px;color:#007AFF;border-right:.5px solid #d2d2d7">Annuler</div><div style="flex:1;padding:10px;font-size:12px;font-weight:600;color:#007AFF">Rejoindre</div></div>`
      + `</div></div>`;
}

function _spIcal(p) {
  let when = '';
  try { if (p.start) when = new Date(p.start).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }); } catch (e) {}
  return _spStatus(false)
    + `<div class="sdqr-sp-nav"><span>Annuler</span><b>Événement</b><span style="font-weight:600">Ajouter</span></div>`
    + `<div class="sdqr-sp-body" style="padding:10px 15px">`
      + `<div style="font-size:15px;font-weight:600;color:#1c1c1e;line-height:1.3;word-break:break-word">${_spVal(p.title, "Titre de l'événement")}</div>`
      + `<div style="margin-top:13px;border-top:.5px solid #ececef;padding-top:11px"><div style="font-size:10px;color:#8a8a8e;letter-spacing:.03em">QUAND</div><div style="font-size:12px;color:#1c1c1e;margin-top:3px">${when ? _esc(when) : '<span class="sdqr-sp-mut">Date et heure</span>'}</div></div>`
      + (p.location ? `<div style="margin-top:11px;border-top:.5px solid #ececef;padding-top:11px"><div style="font-size:10px;color:#8a8a8e;letter-spacing:.03em">OÙ</div><div style="font-size:12px;color:#1c1c1e;margin-top:3px;word-break:break-word">${_esc(p.location)}</div></div>` : '')
    + `</div>`;
}

function _spEmail(p) {
  const body = (p.body || '').trim();
  return _spStatus(false)
    + `<div class="sdqr-sp-nav"><span>Annuler</span><b>Message</b><span>${_spSend('#007AFF')}</span></div>`
    + `<div class="sdqr-sp-body">`
      + `<div class="sdqr-sp-row"><span class="l">À</span><span class="v" style="color:#007AFF">${_spVal(p.email, 'nom@exemple.fr')}</span></div>`
      + `<div class="sdqr-sp-row"><span class="l">Objet</span><span class="v">${_spVal(p.subject, 'Sans objet')}</span></div>`
      + `<div style="padding:11px 15px;font-size:11px;color:#1c1c1e;line-height:1.5;white-space:pre-wrap;word-break:break-word">${body ? _esc(body) : '<span class="sdqr-sp-mut">Votre message pré-rempli…</span>'}</div>`
    + `</div>`;
}

function _spSms(p) {
  const msg = (p.message || '').trim();
  return _spStatus(false)
    + `<div class="sdqr-sp-nav" style="justify-content:center;border-bottom:.5px solid #ececef;padding-bottom:9px"><b>${_spVal(p.phone, 'Nouveau message')}</b></div>`
    + `<div class="sdqr-sp-body" style="justify-content:flex-end;padding:10px 12px"><div style="display:flex;align-items:flex-end;gap:7px"><div style="flex:1;border:1px solid #d8d8dc;border-radius:15px;padding:7px 11px;font-size:11px;color:${msg ? '#1c1c1e' : '#aab2c0'};line-height:1.4;max-height:120px;overflow:hidden;word-break:break-word">${msg ? _esc(msg) : 'Message'}</div><div style="width:27px;height:27px;border-radius:50%;background:#34C759;display:flex;align-items:center;justify-content:center;flex:0 0 auto">${_spSend('#fff')}</div></div></div>`;
}

function _spWhatsapp(p) {
  const msg    = (p.message || '').trim();
  const digits = (p.phone || '').replace(/[^\d]/g, '');
  return `<div style="background:#075E54;color:#fff">${_spStatus(true)}`
    + `<div style="display:flex;align-items:center;gap:8px;padding:1px 12px 10px">${_SP_ICON.back}`
      + `<div style="width:28px;height:28px;border-radius:50%;background:#0c8f7f;display:flex;align-items:center;justify-content:center;flex:0 0 auto"><svg viewBox="0 0 24 24" width="15" height="15" fill="#cfeee4"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6z"/></svg></div>`
      + `<div style="min-width:0"><div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${digits ? '+' + _esc(digits) : 'Contact WhatsApp'}</div><div style="font-size:9px;opacity:.8">en ligne</div></div>`
    + `</div></div>`
    + `<div class="sdqr-sp-body" style="align-items:center;justify-content:flex-start;padding:10px"><div style="background:rgba(255,255,255,.72);border-radius:8px;font-size:9px;color:#54656f;padding:3px 9px">aujourd'hui</div></div>`
    + `<div style="display:flex;align-items:flex-end;gap:7px;padding:8px 10px;background:#f4f4f4;flex:0 0 auto"><div style="flex:1;background:#fff;border-radius:16px;padding:7px 11px;font-size:11px;color:${msg ? '#1c1c1e' : '#9a9a9e'};line-height:1.4;max-height:54px;overflow:hidden;word-break:break-word">${msg ? _esc(msg) : 'Message'}</div><div style="width:28px;height:28px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;flex:0 0 auto">${_spSend('#fff')}</div></div>`;
}

function _spTel(p) {
  const num = (p.phone || '').trim();
  return _spStatus(false)
    + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:0 18px">`
      + `<div style="font-size:20px;font-weight:400;color:#1c1c1e;word-break:break-word">${num ? _esc(num) : '<span class="sdqr-sp-mut">+33 6 …</span>'}</div>`
      + `<div style="font-size:11px;color:#8a8a8e;margin-top:5px">appel mobile</div>`
    + `</div>`
    + `<div style="display:flex;justify-content:center;padding-bottom:30px;flex:0 0 auto"><div style="width:56px;height:56px;border-radius:50%;background:#34C759;display:flex;align-items:center;justify-content:center">${_SP_ICON.phone}</div></div>`;
}

function _spGeo(p) {
  const q = (p.query || '').trim();
  return `<div style="flex:1;min-height:0;position:relative;display:flex;flex-direction:column">`
      + `<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,#dde6e9,#dde6e9 1px,transparent 1px,transparent 24px),repeating-linear-gradient(90deg,#dde6e9,#dde6e9 1px,transparent 1px,transparent 24px),#e8eef0"></div>`
      + `<div style="position:relative;color:#1c1c1e">${_spStatus(false)}</div>`
      + `<div style="position:relative;flex:1;display:flex;align-items:center;justify-content:center">${_spPin('#e24b4a')}</div>`
    + `</div>`
    + `<div style="background:#fff;border-radius:14px 14px 0 0;padding:12px 15px 17px;flex:0 0 auto"><div style="font-size:13px;font-weight:600;color:#1c1c1e;word-break:break-word">${q ? _esc(q) : '<span class="sdqr-sp-mut">Adresse ou lieu</span>'}</div><div style="font-size:10px;color:#8a8a8e;margin-top:2px">Plan</div><div style="margin-top:10px;background:#007AFF;color:#fff;font-size:11px;font-weight:600;text-align:center;padding:8px;border-radius:9px">Itinéraire</div></div>`;
}

// Expériences hébergées (mode smart) : page flavorée par template, avec le
// titre / message / couleur d'accent saisis par l'utilisateur.
function _spExperience(cre, design) {
  const acc   = _acc(design);
  const onAcc = _onColor(acc);
  const tpl   = getTemplate(cre.template_id);
  const title = (cre.smart_title || tpl?.label || 'Expérience').trim();
  const msg   = (cre.smart_message || '').trim();
  const id    = cre.template_id;
  const head  = (sub) => `<div style="background:${acc};color:${onAcc}">${_spStatus(onAcc === '#fff')}`
    + `<div style="padding:1px 14px 11px"><div style="font-size:13px;font-weight:600;word-break:break-word">${_esc(title)}</div>`
    + (sub ? `<div style="font-size:9px;opacity:.82;margin-top:1px">${_esc(sub)}</div>` : '')
    + `</div></div>`;

  if (id === 'concierge') {
    const sub = cre.concierge_source === 'keyform' ? 'Accueil & réponses' : 'Programme & lots';
    return head(sub)
      + `<div class="sdqr-sp-body" style="background:#f6f7fb;padding:12px 11px;gap:8px">`
        + `<div style="font-size:11px;color:#5a6b86">${msg ? _esc(msg) : 'Bonjour, posez-moi votre question.'}</div>`
        + `<div class="sdqr-sp-bubble" style="align-self:flex-start;background:#fff;border:.5px solid #e6e9f0;color:#1c1c1e">Quels sont vos horaires ?</div>`
        + `<div class="sdqr-sp-bubble" style="align-self:flex-end;background:${acc};color:${onAcc}">Du lundi au samedi, 9h-19h.</div>`
      + `</div>`
      + `<div style="display:flex;align-items:center;gap:8px;padding:8px 11px;background:#fff;border-top:.5px solid #eef0f4;flex:0 0 auto"><div style="flex:1;font-size:11px;color:#aab2c0">Écrire…</div>${_spSend(acc)}</div>`;
  }
  if (id === 'carte-fidelite') {
    let dots = '';
    for (let i = 0; i < 10; i++) dots += `<div style="width:15px;height:15px;border-radius:50%;${i < 7 ? 'background:' + acc : 'background:#fff;border:1px solid #d9dee8'}"></div>`;
    return head('Carte de fidélité')
      + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:14px">`
        + `<div style="font-size:11px;color:#8a8a8e">${msg ? _esc(msg) : 'Vos tampons'}</div>`
        + `<div style="font-size:22px;font-weight:700;color:#1c1c1e;margin:3px 0 13px">7 <span style="font-size:13px;color:#b0b0b5;font-weight:400">/ 10</span></div>`
        + `<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;justify-items:center">${dots}</div>`
        + `<div style="font-size:10px;color:#8a8a8e;margin-top:14px;line-height:1.4">Plus que 3 avant<br>votre récompense !</div>`
      + `</div>`;
  }
  if (id === 'countdown-produit') {
    const cell = (v, l) => `<div style="text-align:center"><div style="background:#11182f;color:#fff;font-size:17px;font-weight:700;border-radius:8px;padding:8px 0;min-width:38px">${v}</div><div style="font-size:8px;color:#8a8a8e;margin-top:4px;letter-spacing:.04em">${l}</div></div>`;
    return head('Compte à rebours')
      + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:14px">`
        + `<div style="font-size:11px;color:#5a6b86;line-height:1.4;margin-bottom:14px">${msg ? _esc(msg) : 'Bientôt disponible'}</div>`
        + `<div style="display:flex;gap:7px;justify-content:center">${cell('02', 'JOURS')}${cell('14', 'H')}${cell('37', 'MIN')}${cell('09', 'SEC')}</div>`
      + `</div>`;
  }
  if (id === 'machine-a-sous') {
    const reel = `<div style="width:34px;height:42px;background:#fff;border:1px solid #e6e9f0;border-radius:7px;display:flex;align-items:center;justify-content:center">${_spStar(acc)}</div>`;
    return head('Machine à sous')
      + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:14px">`
        + `<div style="font-size:11px;color:#5a6b86;margin-bottom:13px">${msg ? _esc(msg) : 'Tentez votre chance !'}</div>`
        + `<div style="display:flex;gap:8px;background:#f1f3f9;padding:11px;border-radius:11px">${reel}${reel}${reel}</div>`
        + `<div class="sdqr-sp-cta" style="background:${acc};color:${onAcc};margin-top:15px">Jouer</div>`
      + `</div>`;
  }
  const sub = id === 'boite-cadeau' ? 'Boîte cadeau' : id === 'carte-a-gratter' ? 'Carte à gratter' : 'Découvrez la marque';
  const cta = id === 'storytelling-brand' ? 'Découvrir' : 'Ouvrir';
  return head(sub)
    + `<div class="sdqr-sp-body" style="align-items:center;justify-content:center;text-align:center;padding:18px">`
      + `<div style="width:46px;height:46px;border-radius:13px;background:${acc};color:${onAcc};display:flex;align-items:center;justify-content:center">${_spGift()}</div>`
      + `<div style="font-size:12px;color:#1c1c1e;font-weight:600;margin-top:11px;word-break:break-word">${_esc(title)}</div>`
      + `<div style="font-size:10px;color:#8a8a8e;margin-top:5px;line-height:1.4">${msg ? _esc(msg) : sub}</div>`
      + `<div class="sdqr-sp-cta" style="background:${acc};color:${onAcc};margin-top:14px">${cta}</div>`
    + `</div>`;
}
