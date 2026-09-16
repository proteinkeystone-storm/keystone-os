/* ═══════════════════════════════════════════════════════════════
   KEYSTONE OS — MCP sprint 6 : LE MOTEUR GÉNÉRIQUE (pads-formulaires)
   ───────────────────────────────────────────────────────────────
   Les pads du Master Renderer (app/pads-data.js : PADS_DATA + CATALOG_DATA)
   n'ont AUCUN code par pad ici : leur JSON est déjà un schéma.
     fields        → paramètres (schéma JSON dérivé, validation)
     notice        → mode d'emploi
     system_prompt → la RECETTE, servie à Claude en ressource MCP
                     (keystone://pad/<id>/prompt) : il génère lui-même,
                     avec la recette Keystone, sans crédit Keystone.
   Un pad publié au K-Store est outillé le jour même, sans une ligne.

   Sources : pads-data.js (import dynamique, pur ESM, comme desk-rules) pour
   fields / prompt / notice ; /api/catalog (D1) pour published / plan /
   titre — le catalogue D1 est la boutique, l'embarqué la vérité des champs.
   Visibilité : published ≠ false et sans replacedBy ; un ADMIN voit aussi
   les non publiés (drapeau `publie:false`). Accès : app-access.bagAllows
   (ctx.appAllowed), exactement comme les routes des pads.
   ═══════════════════════════════════════════════════════════════ */

export const FORM_URI_PREFIX = 'keystone://pad/';
export const FORM_URI_SUFFIX = '/prompt';
const FIELD_TYPES = new Set(['text', 'number', 'textarea', 'select', 'multiselect']);
const MAX_TEXT = 4000;

let _data = null;
async function padsData() { if (!_data) _data = await import('../../../app/pads-data.js'); return _data; }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ── Inventaire : pads-formulaires (padKey renseigné), enrichis du catalogue D1 ── */
export async function listFormPads(ctx) {
  const { PADS_DATA, CATALOG_DATA } = await padsData();
  let remote = [];
  try { const d = await ctx.call('/api/catalog'); remote = Array.isArray(d?.catalog?.tools) ? d.catalog.tools : []; } catch (_) { remote = []; }
  const admin = ctx.claims?.isAdmin === true || String(ctx.claims?.plan || '').toUpperCase() === 'ADMIN';
  const out = [];
  for (const [padKey, pad] of Object.entries(PADS_DATA || {})) {
    if (!pad || !pad.id || !Array.isArray(pad.fields)) continue;
    const local = (CATALOG_DATA?.tools || []).find(t => t.id === pad.id) || {};
    const d1 = remote.find(t => t.id === pad.id) || {};
    const published = (d1.published ?? local.published) !== false;
    const replaced = d1.replacedBy || local.replacedBy || pad.replacedBy || null;
    if ((!published || replaced) && !admin) continue;
    out.push({
      id: pad.id, padKey, title: d1.title || local.title || pad.title || pad.id, subtitle: d1.subtitle || local.subtitle || pad.subtitle || null,
      plan: d1.plan || local.plan || null, published, replacedBy: replaced, category: d1.category || local.category || null,
      fields: pad.fields.filter(f => f && f.id && FIELD_TYPES.has(f.type)), notice: pad.notice || null, system_prompt: pad.system_prompt || '',
      doc_export: pad.doc_export ? { label: pad.doc_export.label || null, templateId: pad.doc_export.templateId || null } : null,
      accessible: ctx.appAllowed ? await ctx.appAllowed(pad.id) : true,
    });
  }
  return out;
}

/* Résout un pad par id (O-IMM-002), padKey (A2) ou titre (même partiel). */
export async function resolveFormPad(ctx, ref) {
  const pads = await listFormPads(ctx);
  if (!pads.length) throw new Error('Aucun pad-formulaire publié pour l’instant.');
  const r = norm(ref);
  if (!r) { if (pads.length === 1) return pads[0]; throw new Error(`Plusieurs formulaires : ${pads.map(p => `${p.title} (${p.id})`).join(' · ')}. Précise lequel.`); }
  const hit = pads.find(p => norm(p.id) === r || norm(p.padKey) === r) || pads.find(p => norm(p.title) === r);
  if (hit) return hit;
  const part = pads.filter(p => norm(p.title).includes(r));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`Plusieurs formulaires correspondent à « ${ref} » : ${part.map(p => `${p.title} (${p.id})`).join(' · ')}. Précise.`);
  throw new Error(`Aucun formulaire « ${ref} ». Disponibles : ${pads.map(p => `${p.title} (${p.id})`).join(' · ')}.`);
}

/* ── Schéma JSON dérivé des fields (pour Claude, et pour la validation) ── */
export function formSchema(pad) {
  const properties = {}, required = [];
  for (const f of pad.fields) {
    let p;
    if (f.type === 'number') p = { type: 'number' };
    else if (f.type === 'select') p = { type: 'string', enum: (f.options || []).map(String) };
    else if (f.type === 'multiselect') p = { type: 'array', items: { type: 'string', enum: (f.options || []).map(String) } };
    else p = { type: 'string', maxLength: MAX_TEXT };
    p.description = [f.label, f.placeholder ? `ex. ${f.placeholder}` : null].filter(Boolean).join(' — ');
    properties[f.id] = p;
    if (f.required) required.push(f.id);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

/* ── Validation stricte : inconnu, requis, options, nombres. → { ok, data, errors } ── */
export function validateFormData(pad, data) {
  const errors = [], clean = {};
  const src = (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  if (!src) return { ok: false, errors: ['data doit être un objet { champ: valeur }'], data: {} };
  const byId = new Map(pad.fields.map(f => [f.id, f]));
  for (const k of Object.keys(src)) if (!byId.has(k)) errors.push(`champ inconnu : ${k}`);
  for (const f of pad.fields) {
    const v = src[f.id];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (f.required) errors.push(`champ requis manquant : ${f.id} (${f.label})`); continue; }
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/\s/g, ''));
      if (!Number.isFinite(n)) { errors.push(`${f.id} : nombre attendu`); continue; }
      clean[f.id] = n;
    } else if (f.type === 'select') {
      const opts = (f.options || []).map(String); const s = String(v);
      const hit = opts.find(o => o === s) || opts.find(o => norm(o) === norm(s));
      if (!hit) { errors.push(`${f.id} : valeur « ${s} » hors options (${opts.join(' | ')})`); continue; }
      clean[f.id] = hit;
    } else if (f.type === 'multiselect') {
      const opts = (f.options || []).map(String);
      const arr = Array.isArray(v) ? v : String(v).split(',');
      const picked = [];
      for (const x of arr.map(s => String(s).trim()).filter(Boolean)) {
        const hit = opts.find(o => o === x) || opts.find(o => norm(o) === norm(x));
        if (!hit) { errors.push(`${f.id} : « ${x} » hors options (${opts.join(' | ')})`); continue; }
        if (!picked.includes(hit)) picked.push(hit);
      }
      if (picked.length) clean[f.id] = picked.join(', ');          // format attendu par _prefillForm (CSV)
    } else {
      const s = String(v);
      if (s.length > MAX_TEXT) { errors.push(`${f.id} : texte trop long (max ${MAX_TEXT})`); continue; }
      clean[f.id] = s;
    }
  }
  return { ok: !errors.length, errors, data: clean };
}

/* ── La recette en Markdown (ressource MCP) ── */
export function formPromptMarkdown(pad) {
  const lines = [`# ${pad.title} — recette Keystone (${pad.id})`, ''];
  if (pad.subtitle) lines.push(pad.subtitle, '');
  lines.push('## Champs', '', '| id | libellé | type | requis | options |', '|---|---|---|---|---|');
  for (const f of pad.fields) lines.push(`| ${f.id} | ${f.label || ''} | ${f.type} | ${f.required ? 'oui' : 'non'} | ${(f.options || []).join(' · ')} |`);
  lines.push('');
  if (pad.notice) lines.push('## Mode d’emploi', '', String(pad.notice), '');
  lines.push('## Recette (system prompt du pad — les {{champ}} sont à substituer par les valeurs)', '', '```', String(pad.system_prompt || '(ce pad n’a pas de recette IA : il génère un document depuis les champs)'), '```', '');
  if (pad.doc_export) lines.push(`## Export`, '', `Ce pad sait produire « ${pad.doc_export.label || 'un document'} » (gabarit ${pad.doc_export.templateId || '?'}) depuis les champs, dans Keystone.`, '');
  lines.push('_Servi par le serveur MCP Keystone : génère avec cette recette, puis propose keystone_form_fill pour retrouver le formulaire pré-rempli dans Keystone._');
  return lines.join('\n');
}
export const formUri = (id) => `${FORM_URI_PREFIX}${id}${FORM_URI_SUFFIX}`;
export function padIdFromUri(uri) {
  const s = String(uri || '');
  if (!s.startsWith(FORM_URI_PREFIX) || !s.endsWith(FORM_URI_SUFFIX)) return null;
  const id = s.slice(FORM_URI_PREFIX.length, -FORM_URI_SUFFIX.length);
  return /^[A-Za-z]-[A-Za-z]+-\d{3}$/.test(id) ? id : null;
}
export async function formResources(ctx) {
  const pads = await listFormPads(ctx);
  return pads.filter(p => p.accessible).map(p => ({ uri: formUri(p.id), name: `pad/${p.id}/prompt`, title: `${p.title} — recette`, mimeType: 'text/markdown',
    description: `Recette et champs du pad « ${p.title} » (${p.fields.length} champs). Claude génère lui-même avec cette recette.` }));
}
